<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserSummaryResource;
use App\Models\Conversation;
use App\Models\Organization;
use App\Support\Attachments;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;

/**
 * Organisation-scoped search. Every query starts from the same "visible"
 * scopes used elsewhere, so results, snippets and counts only ever include
 * resources the user can currently open.
 */
class SearchController extends Controller
{
    private const TYPES = ['messages', 'channels', 'projects', 'tasks', 'files'];

    public function __invoke(Request $request, Organization $organization): JsonResponse
    {
        $data = $request->validate([
            'q' => ['required', 'string', 'min:2', 'max:100'],
            'type' => ['nullable', Rule::in(self::TYPES)],
            'page' => ['nullable', 'integer', 'min:1'],
        ]);

        $user = $request->user();
        $q = trim($data['q']);
        $term = '%'.addcslashes($q, '%_\\').'%';
        $single = $data['type'] ?? null;
        $perPage = $single ? 20 : 5;

        $conversations = Permissions::visibleConversationsQuery($user, $organization->id)->select('id');
        $projects = Permissions::visibleProjectsQuery($user, $organization->id)->select('id');

        $queries = [
            'messages' => fn () => $organization->messages()
                ->whereIn('conversation_id', $conversations)
                ->whereNull('deleted_at')
                ->where('body', 'ilike', $term)
                ->with(['user', 'conversation'])
                ->latest('id'),
            'channels' => fn () => Permissions::visibleConversationsQuery($user, $organization->id)
                ->where('type', Conversation::TYPE_CHANNEL)
                ->where(fn ($w) => $w->where('name', 'ilike', $term)->orWhere('topic', 'ilike', $term))
                ->orderBy('name'),
            'projects' => fn () => Permissions::visibleProjectsQuery($user, $organization->id)
                ->where(fn ($w) => $w->where('name', 'ilike', $term)->orWhere('description', 'ilike', $term))
                ->orderBy('name'),
            'tasks' => fn () => $organization->tasks()
                ->whereIn('project_id', $projects)
                ->where(fn ($w) => $w->where('title', 'ilike', $term)->orWhere('description', 'ilike', $term))
                ->with(['project:id,name', 'assignee'])
                ->latest('updated_at'),
            'files' => fn () => Attachments::visibleQuery($user, $organization->id)
                ->where('original_name', 'ilike', $term)
                ->latest('attachments.id'),
        ];

        $results = [];
        foreach ($single ? [$single] : self::TYPES as $type) {
            $page = $queries[$type]()->paginate($perPage, ['*'], 'page', $single ? $request->integer('page', 1) : 1);
            $results[$type] = [
                'total' => $page->total(),
                'last_page' => $page->lastPage(),
                'items' => $page->getCollection()->map(fn ($item) => $this->present($type, $item, $q, $organization))->values(),
            ];
        }

        return response()->json(['data' => $results, 'query' => $q]);
    }

    private function present(string $type, $item, string $q, Organization $organization): array
    {
        return match ($type) {
            'messages' => [
                'id' => $item->id,
                'title' => $item->conversation->isDirect() ? 'Direct message' : '#'.$item->conversation->name,
                'snippet' => $this->snippet($item->body, $q),
                'user' => $item->user ? new UserSummaryResource($item->user) : null,
                'link' => '/chat/'.$item->conversation_id.'?message='.$item->id,
                'created_at' => $item->created_at->toIso8601String(),
            ],
            'channels' => [
                'id' => $item->id,
                'title' => '#'.$item->name,
                'snippet' => $item->topic,
                'visibility' => $item->visibility,
                'link' => '/chat/'.$item->id,
            ],
            'projects' => [
                'id' => $item->id,
                'title' => $item->name,
                'snippet' => $this->snippet((string) $item->description, $q),
                'status' => $item->status->value,
                'link' => '/projects/'.$item->id,
            ],
            'tasks' => [
                'id' => $item->id,
                'title' => $item->title,
                'snippet' => $item->project->name,
                'status' => $item->status->value,
                'link' => '/projects/'.$item->project_id.'?task='.$item->id,
            ],
            'files' => [
                'id' => $item->id,
                'title' => $item->original_name,
                'snippet' => strtoupper($item->extension).' · '.number_format($item->size / 1024, 0).' KB',
                'download_url' => url('/api/orgs/'.$organization->slug.'/attachments/'.$item->id.'/download'),
                'link' => '/files?q='.urlencode($item->original_name),
            ],
        };
    }

    private function snippet(?string $text, string $q, int $radius = 70): ?string
    {
        if (! $text) {
            return null;
        }
        $pos = mb_stripos($text, $q);
        if ($pos === false) {
            return mb_strimwidth($text, 0, $radius * 2, '…');
        }
        $start = max(0, $pos - $radius);

        return ($start > 0 ? '…' : '').mb_substr($text, $start, mb_strlen($q) + $radius * 2).(mb_strlen($text) > $start + mb_strlen($q) + $radius * 2 ? '…' : '');
    }
}
