<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserSummaryResource;
use App\Models\Organization;
use App\Models\UserNotification;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class NotificationController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['unread' => ['nullable', 'boolean'], 'per_page' => ['nullable', 'integer', 'min:1', 'max:100']]);

        $page = $this->query($request, $organization)->with('actor')
            ->when($request->boolean('unread'), fn ($q) => $q->whereNull('read_at'))
            ->latest('created_at')
            ->paginate($request->integer('per_page', 20));

        return response()->json([
            'data' => $page->getCollection()->map(fn (UserNotification $n) => [
                'id' => $n->id,
                'type' => $n->type,
                'title' => $n->title,
                'body' => $n->body,
                'link' => $n->link,
                'actor' => $n->actor ? new UserSummaryResource($n->actor) : null,
                'read' => $n->read_at !== null,
                'created_at' => $n->created_at->toIso8601String(),
            ])->values(),
            'meta' => [
                'current_page' => $page->currentPage(),
                'last_page' => $page->lastPage(),
                'total' => $page->total(),
                'unread_count' => $this->query($request, $organization)->whereNull('read_at')->count(),
            ],
        ]);
    }

    public function unreadCount(Request $request, Organization $organization): JsonResponse
    {
        return response()->json(['data' => ['unread_count' => $this->query($request, $organization)->whereNull('read_at')->count()]]);
    }

    public function markRead(Request $request, Organization $organization, string $notification): JsonResponse
    {
        $updated = $this->query($request, $organization)->whereKey($notification)->whereNull('read_at')->update(['read_at' => now()]);
        abort_if($updated === 0 && ! $this->query($request, $organization)->whereKey($notification)->exists(), 404);

        return response()->json(['message' => 'Marked as read.']);
    }

    public function markAllRead(Request $request, Organization $organization): JsonResponse
    {
        $count = $this->query($request, $organization)->whereNull('read_at')->update(['read_at' => now()]);

        return response()->json(['message' => 'All notifications marked as read.', 'updated' => $count]);
    }

    private function query(Request $request, Organization $organization)
    {
        return UserNotification::query()
            ->where('user_id', $request->user()->id)
            ->where('organization_id', $organization->id);
    }
}
