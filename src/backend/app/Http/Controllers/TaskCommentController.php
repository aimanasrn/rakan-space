<?php

namespace App\Http\Controllers;

use App\Http\Resources\UserSummaryResource;
use App\Models\Organization;
use App\Models\Task;
use App\Models\TaskComment;
use App\Support\ActivityLog;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

class TaskCommentController extends Controller
{
    public function index(Request $request, Organization $organization, Task $task): JsonResponse
    {
        abort_unless(Permissions::canViewTask($request->user(), $task), 404);

        $comments = $task->comments()->with('user')->orderBy('id')->paginate(100);

        return response()->json([
            'data' => $comments->getCollection()->map(fn ($c) => $this->present($c, $request))->values(),
            'meta' => ['total' => $comments->total(), 'current_page' => $comments->currentPage(), 'last_page' => $comments->lastPage()],
        ]);
    }

    public function store(Request $request, Organization $organization, Task $task): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless(Permissions::canContributeToProject($user, $task->project), 403, 'Only project members can comment.');

        $data = $request->validate(['body' => ['required', 'string', 'max:5000']]);
        $comment = $task->comments()->create(['user_id' => $user->id, 'body' => $data['body']]);

        ActivityLog::record($organization->id, $user, 'task.commented', $task, ['title' => $task->title], $task->project_id);
        Notifier::send($organization->id, array_filter([$task->assignee_id, $task->created_by]), 'task.comment',
            $user->name.' commented on "'.$task->title.'"', mb_strimwidth($data['body'], 0, 140, '…'),
            '/projects/'.$task->project_id.'?task='.$task->id, $user->id, 'task-comment:'.$comment->id);

        return response()->json(['data' => $this->present($comment->load('user'), $request)], 201);
    }

    public function destroy(Request $request, Organization $organization, Task $task, TaskComment $comment): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless($comment->user_id === $user->id || Permissions::canManageProject($user, $task->project), 403, 'You cannot delete this comment.');

        $comment->delete();

        return response()->json(['message' => 'Comment deleted.']);
    }

    private function present(TaskComment $comment, Request $request): array
    {
        return [
            'id' => $comment->id,
            'body' => $comment->body,
            'user' => $comment->user ? new UserSummaryResource($comment->user) : null,
            'can_delete' => $comment->user_id === $request->user()->id,
            'created_at' => $comment->created_at->toIso8601String(),
        ];
    }
}
