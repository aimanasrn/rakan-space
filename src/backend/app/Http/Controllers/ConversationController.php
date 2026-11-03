<?php

namespace App\Http\Controllers;

use App\Events\UserEvent;
use App\Http\Resources\UserSummaryResource;
use App\Models\Conversation;
use App\Models\Organization;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Permissions;
use Illuminate\Database\QueryException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ConversationController extends Controller
{
    /** Conversations the user belongs to, with unread counts. */
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();

        $conversations = Conversation::query()
            ->where('organization_id', $organization->id)
            ->join('conversation_members as me', function ($join) use ($user) {
                $join->on('me.conversation_id', '=', 'conversations.id')->where('me.user_id', '=', $user->id);
            })
            ->select('conversations.*', 'me.last_read_message_id', 'me.role as my_role')
            ->selectSub(fn ($q) => $q->from('messages')->selectRaw('count(*)')
                ->whereColumn('messages.conversation_id', 'conversations.id')
                ->whereNull('messages.deleted_at')
                ->where('messages.user_id', '!=', $user->id)
                ->whereRaw('messages.id > coalesce(me.last_read_message_id, 0)'), 'unread_count')
            ->orderByRaw('conversations.last_message_at DESC NULLS LAST')
            ->orderBy('conversations.name')
            ->get();

        $this->attachDirectPartners($conversations, $user);

        return response()->json(['data' => $conversations->map(fn ($c) => $this->present($c, $user))->values()]);
    }

    /** Public channels the user can join. */
    public function browse(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $channels = $organization->conversations()
            ->where('type', Conversation::TYPE_CHANNEL)
            ->where('visibility', Conversation::VISIBILITY_PUBLIC)
            ->whereNull('archived_at')
            ->withCount('memberships')
            ->withExists(['memberships as is_member' => fn ($q) => $q->where('user_id', $user->id)])
            ->when($request->filled('q'), fn ($q) => $q->where('name', 'ilike', '%'.addcslashes($request->input('q'), '%_\\').'%'))
            ->orderBy('name')->limit(200)->get();

        return response()->json(['data' => $channels->map(fn ($c) => [
            'id' => $c->id,
            'name' => $c->name,
            'topic' => $c->topic,
            'members_count' => $c->memberships_count,
            'is_member' => (bool) $c->is_member,
        ])]);
    }

    public function storeChannel(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'name' => ['required', 'string', 'max:80', 'regex:/^[a-z0-9][a-z0-9\-_]*$/',
                Rule::unique('conversations')->where('organization_id', $organization->id)->where('type', Conversation::TYPE_CHANNEL)],
            'topic' => ['nullable', 'string', 'max:250'],
            'visibility' => ['required', Rule::in([Conversation::VISIBILITY_PUBLIC, Conversation::VISIBILITY_PRIVATE])],
            'member_ids' => ['sometimes', 'array', 'max:500'],
            'member_ids.*' => ['integer'],
        ], ['name.regex' => 'Use lowercase letters, numbers, hyphens or underscores.']);

        $memberIds = collect($data['member_ids'] ?? [])->map(fn ($id) => (int) $id)->reject(fn ($id) => $id === $user->id)->unique()->values()->all();
        abort_if(count($organization->filterActiveMemberIds($memberIds)) !== count($memberIds), 422, 'Channel members must be active members of this workspace.');

        $conversation = DB::transaction(function () use ($organization, $data, $user, $memberIds) {
            $conversation = $organization->conversations()->create([
                'type' => Conversation::TYPE_CHANNEL,
                'name' => $data['name'],
                'topic' => $data['topic'] ?? null,
                'visibility' => $data['visibility'],
                'created_by' => $user->id,
            ]);
            $conversation->memberships()->create(['user_id' => $user->id, 'role' => 'admin', 'joined_at' => now()]);
            foreach ($memberIds as $id) {
                $conversation->memberships()->create(['user_id' => $id, 'role' => 'member', 'joined_at' => now()]);
            }
            ActivityLog::record($organization->id, $user, 'channel.created', $conversation, ['name' => $conversation->name, 'visibility' => $conversation->visibility]);

            return $conversation;
        });

        $this->signalMembershipChanged([$user->id, ...$memberIds], $organization);

        return response()->json(['data' => $this->detail($conversation, $user)], 201);
    }

    /** Find or create the 1:1 conversation with another member. */
    public function direct(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['user_id' => ['required', 'integer', 'different:'.$user->id]], ['user_id.different' => 'Choose someone else.']);
        $otherId = (int) $data['user_id'];
        abort_unless($organization->hasActiveMember($otherId), 422, 'That person is not an active member of this workspace.');

        $key = Conversation::directKey($user->id, $otherId);
        $conversation = $organization->conversations()->where('direct_key', $key)->first();

        if (! $conversation) {
            try {
                $conversation = DB::transaction(function () use ($organization, $key, $user, $otherId) {
                    $conversation = $organization->conversations()->create([
                        'type' => Conversation::TYPE_DIRECT,
                        'visibility' => Conversation::VISIBILITY_PRIVATE,
                        'direct_key' => $key,
                        'created_by' => $user->id,
                    ]);
                    $conversation->memberships()->createMany([
                        ['user_id' => $user->id, 'role' => 'member', 'joined_at' => now()],
                        ['user_id' => $otherId, 'role' => 'member', 'joined_at' => now()],
                    ]);

                    return $conversation;
                });
                $this->signalMembershipChanged([$user->id, $otherId], $organization);
            } catch (QueryException) {
                // Created concurrently by the other person.
                $conversation = $organization->conversations()->where('direct_key', $key)->firstOrFail();
            }
        }

        // A previously removed participant cannot silently regain access.
        abort_unless(Permissions::isConversationMember($user, $conversation), 404);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function show(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function update(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless(Permissions::canManageConversation($user, $conversation), 403, 'Only channel admins can change this channel.');

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:80', 'regex:/^[a-z0-9][a-z0-9\-_]*$/',
                Rule::unique('conversations')->where('organization_id', $organization->id)->where('type', Conversation::TYPE_CHANNEL)->ignore($conversation->id)],
            'topic' => ['nullable', 'string', 'max:250'],
            'archived' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('archived', $data)) {
            $conversation->archived_at = $data['archived'] ? ($conversation->archived_at ?? now()) : null;
            unset($data['archived']);
        }
        $conversation->fill($data)->save();
        ActivityLog::record($organization->id, $user, 'channel.updated', $conversation, ['fields' => array_keys($data)]);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function join(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless($conversation->isPublic() && ! $conversation->archived_at, 403, 'Private channels require an invitation from a channel member.');

        $conversation->memberships()->firstOrCreate(['user_id' => $user->id], [
            'role' => 'member', 'joined_at' => now(), 'last_read_message_id' => $conversation->messages()->max('id'),
        ]);
        $this->signalMembershipChanged([$user->id], $organization);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function leave(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless($conversation->isChannel(), 422, 'You cannot leave a direct conversation.');
        abort_unless(Permissions::isConversationMember($user, $conversation), 404);

        $conversation->memberships()->where('user_id', $user->id)->delete();
        $this->signalMembershipChanged([$user->id], $organization);

        return response()->json(['message' => 'You left the channel.']);
    }

    public function addMembers(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless(Permissions::canManageConversation($user, $conversation), 403, 'Only channel admins can add members.');

        $data = $request->validate(['user_ids' => ['required', 'array', 'min:1', 'max:200'], 'user_ids.*' => ['integer']]);
        $ids = $organization->filterActiveMemberIds($data['user_ids']);
        abort_if(count($ids) !== count(array_unique($data['user_ids'])), 422, 'Channel members must be active members of this workspace.');

        $lastId = $conversation->messages()->max('id');
        foreach ($ids as $id) {
            $conversation->memberships()->firstOrCreate(['user_id' => $id], ['role' => 'member', 'joined_at' => now(), 'last_read_message_id' => $lastId]);
        }
        ActivityLog::record($organization->id, $user, 'channel.members_added', $conversation, ['count' => count($ids)]);
        $this->signalMembershipChanged($ids, $organization);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function removeMember(Request $request, Organization $organization, Conversation $conversation, int $userId): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);
        abort_unless(Permissions::canManageConversation($user, $conversation), 403, 'Only channel admins can remove members.');
        abort_if($userId === $user->id, 422, 'Use "Leave channel" to remove yourself.');

        $conversation->memberships()->where('user_id', $userId)->delete();
        ActivityLog::record($organization->id, $user, 'channel.member_removed', $conversation, ['user_id' => $userId]);
        $this->signalMembershipChanged([$userId], $organization);
        UserEvent::dispatch($userId, 'access.revoked', ['organization_id' => $organization->id, 'conversation_id' => $conversation->id]);

        return response()->json(['data' => $this->detail($conversation, $user)]);
    }

    public function markRead(Request $request, Organization $organization, Conversation $conversation): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate(['message_id' => ['required', 'integer']]);
        abort_unless(Permissions::canViewConversation($user, $conversation), 404);

        $exists = $conversation->messages()->whereKey($data['message_id'])->exists();
        abort_unless($exists, 422, 'Unknown message.');

        // Only move the read position forward.
        $conversation->memberships()->where('user_id', $user->id)
            ->where(fn ($q) => $q->whereNull('last_read_message_id')->orWhere('last_read_message_id', '<', $data['message_id']))
            ->update(['last_read_message_id' => $data['message_id']]);

        return response()->json(['message' => 'Marked as read.']);
    }

    // ------------------------------------------------------------- Helpers

    private function detail(Conversation $conversation, User $user): array
    {
        $memberships = $conversation->memberships()->with('user')->get();
        $mine = $memberships->firstWhere('user_id', $user->id);
        $conversation->setAttribute('last_read_message_id', $mine?->last_read_message_id);
        $conversation->setAttribute('my_role', $mine?->role);

        if ($conversation->isDirect()) {
            $conversation->setAttribute('partner', $memberships->firstWhere('user_id', '!=', $user->id)?->user);
        }

        return [
            ...$this->present($conversation, $user),
            'members' => $memberships->sortBy(fn ($m) => $m->user->name)->values()->map(fn ($m) => [
                'role' => $m->role,
                'user' => new UserSummaryResource($m->user),
            ]),
            'permissions' => [
                'post' => Permissions::canPostInConversation($user, $conversation),
                'manage' => Permissions::canManageConversation($user, $conversation),
                'join' => $conversation->isPublic() && ! $mine && ! $conversation->archived_at,
                'leave' => $conversation->isChannel() && (bool) $mine,
            ],
        ];
    }

    private function present(Conversation $c, User $user): array
    {
        return [
            'id' => $c->id,
            'type' => $c->type,
            'name' => $c->isDirect() ? ($c->partner?->name ?? 'Former member') : $c->name,
            'topic' => $c->topic,
            'visibility' => $c->visibility,
            'archived' => $c->archived_at !== null,
            'is_member' => $c->my_role !== null,
            'partner' => $c->isDirect() && $c->partner ? new UserSummaryResource($c->partner) : null,
            'last_read_message_id' => $c->last_read_message_id,
            'unread_count' => (int) ($c->unread_count ?? 0),
            'last_message_at' => $c->last_message_at?->toIso8601String(),
        ];
    }

    private function attachDirectPartners($conversations, User $user): void
    {
        $directIds = $conversations->where('type', Conversation::TYPE_DIRECT)->pluck('id');
        if ($directIds->isEmpty()) {
            return;
        }

        $partners = DB::table('conversation_members')->whereIn('conversation_id', $directIds)
            ->where('user_id', '!=', $user->id)->pluck('user_id', 'conversation_id');
        $users = User::whereIn('id', $partners->values())->get()->keyBy('id');

        foreach ($conversations as $c) {
            if ($c->isDirect()) {
                $c->setAttribute('partner', $users->get($partners->get($c->id)));
            }
        }
    }

    /** @param array<int> $userIds */
    private function signalMembershipChanged(array $userIds, Organization $organization): void
    {
        foreach (array_unique($userIds) as $id) {
            UserEvent::dispatch((int) $id, 'conversations.changed', ['organization_id' => $organization->id]);
        }
    }
}
