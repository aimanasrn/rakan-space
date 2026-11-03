<?php

namespace App\Http\Controllers;

use App\Events\ConversationMessageChanged;
use App\Http\Resources\MessageResource;
use App\Models\Conversation;
use App\Models\Message;
use App\Models\Organization;
use App\Models\User;
use App\Support\Attachments;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

class MessageController extends Controller
{
    /**
     * Paginated history in ascending order.
     *   ?before=<id>  older page (scrolling up)
     *   ?after=<id>   newer messages (real-time catch-up and reconnection recovery)
     */
    public function index(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        abort_unless(Permissions::canViewConversation($request->user(), $conversation), 404);
        $request->validate([
            'before' => ['nullable', 'integer'],
            'after' => ['nullable', 'integer'],
            'limit' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $limit = $request->integer('limit', 50);

        $query = $conversation->messages()->with(['user', 'parent.user', 'attachments']);

        if ($request->filled('after')) {
            $messages = $query->where('id', '>', $request->integer('after'))->orderBy('id')->limit($limit + 1)->get();
            $hasMore = $messages->count() > $limit;
            $messages = $messages->take($limit);
        } else {
            $messages = $query->when($request->filled('before'), fn ($q) => $q->where('id', '<', $request->integer('before')))
                ->orderByDesc('id')->limit($limit + 1)->get();
            $hasMore = $messages->count() > $limit;
            $messages = $messages->take($limit)->reverse()->values();
        }

        return response()->json([
            'data' => MessageResource::collection($messages)->resolve($request),
            'meta' => ['has_more' => $hasMore],
        ]);
    }

    /** Fetch specific messages, e.g. after an "updated" or "deleted" broadcast. */
    public function show(Request $request, Organization $organization, Conversation $conversation, Message $message): MessageResource
    {
        abort_unless(Permissions::canViewConversation($request->user(), $conversation), 404);

        return new MessageResource($message->load(['user', 'parent.user', 'attachments']));
    }

    /**
     * Idempotent send: the client generates client_id once and reuses it on
     * retries; a retry returns the already-stored message (200) instead of
     * creating a duplicate.
     */
    public function store(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);

        $data = $request->validate([
            'client_id' => ['required', 'uuid'],
            'body' => ['nullable', 'required_without:attachment_ids', 'string', 'max:10000'],
            'parent_id' => ['nullable', 'integer'],
            'mentions' => ['sometimes', 'array', 'max:50'],
            'mentions.*' => ['integer'],
            'attachment_ids' => ['sometimes', 'array', 'max:10'],
            'attachment_ids.*' => ['integer'],
        ]);

        if ($existing = $this->findExisting($user, $data['client_id'], $conversation)) {
            return response()->json(['data' => $existing, 'duplicate' => true]);
        }

        abort_unless(Permissions::canPostInConversation($user, $conversation), 403,
            $conversation->archived_at ? 'This channel is archived.' : 'Join this channel to send messages.');

        if (! empty($data['parent_id'])) {
            abort_unless($conversation->messages()->whereKey($data['parent_id'])->exists(), 422, 'You can only reply to messages in this conversation.');
        }

        $mentionIds = $this->eligibleMentions($conversation, $data['mentions'] ?? [], $user);

        try {
            $message = DB::transaction(function () use ($organization, $conversation, $user, $data, $mentionIds) {
                $message = $conversation->messages()->create([
                    'organization_id' => $organization->id,
                    'user_id' => $user->id,
                    'client_id' => $data['client_id'],
                    'parent_id' => $data['parent_id'] ?? null,
                    'body' => isset($data['body']) ? trim($data['body']) : null,
                    'mentions' => $mentionIds ?: null,
                ]);

                Attachments::attach($user, $organization, $data['attachment_ids'] ?? [], $message);

                $conversation->forceFill(['last_message_at' => $message->created_at])->save();
                $conversation->memberships()->where('user_id', $user->id)->update(['last_read_message_id' => $message->id]);

                // Persisted first; the broadcast is dispatched after commit.
                ConversationMessageChanged::dispatch($message, 'created');

                return $message;
            });
        } catch (UniqueConstraintViolationException) {
            // A concurrent retry with the same client_id won the race.
            return response()->json(['data' => $this->findExisting($user, $data['client_id'], $conversation), 'duplicate' => true]);
        }

        if ($mentionIds) {
            $where = $conversation->isDirect() ? 'a direct message' : '#'.$conversation->name;
            Notifier::send($organization->id, $mentionIds, 'mention', $user->name.' mentioned you in '.$where,
                // Message text is not copied into notifications.
                null, '/chat/'.$conversation->id.'?message='.$message->id, $user->id, 'mention:'.$message->id);
        }

        return response()->json(['data' => (new MessageResource($message->load(['user', 'parent.user', 'attachments'])))->resolve($request)], 201);
    }

    public function update(Request $request, Organization $organization, Conversation $conversation, Message $message): MessageResource
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless(Permissions::canEditMessage($user, $message), 403, 'You can only edit your own messages.');

        $data = $request->validate(['body' => ['required', 'string', 'max:10000']]);
        DB::transaction(function () use ($message, $data) {
            $message->update(['body' => trim($data['body']), 'edited_at' => now()]);
            ConversationMessageChanged::dispatch($message, 'updated');
        });

        return new MessageResource($message->load(['user', 'parent.user', 'attachments']));
    }

    public function destroy(Request $request, Organization $organization, Conversation $conversation, Message $message): MessageResource
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless(Permissions::canDeleteMessage($user, $message), 403, 'You cannot delete this message.');

        DB::transaction(function () use ($message) {
            $message->update(['body' => null, 'mentions' => null, 'deleted_at' => now()]);
            ConversationMessageChanged::dispatch($message, 'deleted');
        });

        return new MessageResource($message->load(['user', 'parent.user', 'attachments']));
    }

    private function findExisting(User $user, string $clientId, Conversation $conversation): ?array
    {
        $existing = Message::where('user_id', $user->id)->where('client_id', $clientId)->first();
        if (! $existing) {
            return null;
        }
        abort_unless($existing->conversation_id === $conversation->id, 422, 'This client_id was already used in another conversation.');

        return (new MessageResource($existing->load(['user', 'parent.user', 'attachments'])))->resolve(request());
    }

    /**
     * Mentions only notify people who can read the conversation, so a mention
     * never leaks a private conversation to a non-member.
     *
     * @return list<int>
     */
    private function eligibleMentions(Conversation $conversation, array $ids, User $sender): array
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($ids === []) {
            return [];
        }

        $eligible = $conversation->isPublic()
            ? $conversation->organization->filterActiveMemberIds($ids)
            : $conversation->memberships()->whereIn('user_id', $ids)->pluck('user_id')->map(fn ($id) => (int) $id)->all();

        return array_values(array_filter($eligible, fn ($id) => $id !== $sender->id));
    }
}
