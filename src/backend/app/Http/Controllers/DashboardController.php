<?php

namespace App\Http\Controllers;

use App\Http\Resources\ActivityResource;
use App\Http\Resources\ProjectResource;
use App\Http\Resources\TaskResource;
use App\Http\Resources\UserSummaryResource;
use App\Models\Activity;
use App\Models\Organization;
use App\Models\UserNotification;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/** Overview page data, scoped to the active organisation and current permissions. */
class DashboardController extends Controller
{
    public function __invoke(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $today = now($organization->timezone)->toDateString();
        $visibleProjects = Permissions::visibleProjectsQuery($user, $organization->id)->whereNull('archived_at');
        $projectIds = (clone $visibleProjects)->select('id');

        $myTasks = $organization->tasks()->whereIn('project_id', $projectIds)
            ->where('assignee_id', $user->id)->where('status', '!=', 'done')
            ->with(['project.memberships', 'assignee'])
            ->orderByRaw('due_date ASC NULLS LAST')->orderByDesc('priority')->limit(8)->get();

        $deadlines = $organization->tasks()->whereIn('project_id', $projectIds)
            ->where('status', '!=', 'done')->whereNotNull('due_date')
            ->where('due_date', '<=', now($organization->timezone)->addDays(14)->toDateString())
            ->where(fn ($q) => $q->where('assignee_id', $user->id)->orWhere('created_by', $user->id))
            ->with(['project.memberships', 'assignee'])
            ->orderBy('due_date')->limit(8)->get();

        $events = Permissions::visibleEventsQuery($user, $organization->id)
            ->where('ends_at', '>=', now())->where('starts_at', '<=', now()->addDays(14))
            ->orderBy('starts_at')->limit(5)->get();

        $projects = ProjectController::withProgress(
            (clone $visibleProjects)->where('status', 'active')->with(['manager', 'memberships'])
        )->orderBy('target_date')->limit(6)->get();

        $announcements = Permissions::visibleAnnouncementsQuery($user, $organization->id)
            ->with('author')
            ->withExists(['acknowledgements as acknowledged_by_me' => fn ($q) => $q->where('user_id', $user->id)])
            ->orderByRaw('pinned_at IS NULL')->latest('id')->limit(4)->get();

        $notifications = UserNotification::where('user_id', $user->id)->where('organization_id', $organization->id)
            ->whereNull('read_at')->latest('created_at')->limit(5)->get();

        // Activity limited to projects the user can see.
        $activity = Activity::where('organization_id', $organization->id)
            ->where('is_audit', false)
            ->whereIn('project_id', $projectIds)
            ->with('actor')->latest('id')->limit(12)->get();

        return response()->json(['data' => [
            'today' => $today,
            'timezone' => $organization->timezone,
            'my_tasks' => TaskResource::collection($myTasks)->resolve($request),
            'my_open_tasks_count' => $organization->tasks()->whereIn('project_id', $projectIds)->where('assignee_id', $user->id)->where('status', '!=', 'done')->count(),
            'overdue_count' => $organization->tasks()->whereIn('project_id', $projectIds)->where('assignee_id', $user->id)
                ->where('status', '!=', 'done')->where('due_date', '<', $today)->count(),
            'deadlines' => TaskResource::collection($deadlines)->resolve($request),
            'events' => $events->map(fn ($e) => [
                'id' => $e->id, 'title' => $e->title, 'starts_at' => $e->starts_at->toIso8601String(),
                'ends_at' => $e->ends_at->toIso8601String(), 'location' => $e->location, 'meeting_url' => $e->meeting_url,
            ]),
            'projects' => ProjectResource::collection($projects)->resolve($request),
            'announcements' => $announcements->map(fn ($a) => [
                'id' => $a->id, 'title' => $a->title, 'excerpt' => mb_strimwidth($a->body, 0, 180, '…'),
                'pinned' => $a->pinned_at !== null, 'requires_acknowledgement' => $a->requires_acknowledgement,
                'acknowledged' => (bool) $a->acknowledged_by_me,
                'author' => $a->author ? new UserSummaryResource($a->author) : null,
                'created_at' => $a->created_at->toIso8601String(),
            ]),
            'notifications' => $notifications->map(fn ($n) => [
                'id' => $n->id, 'type' => $n->type, 'title' => $n->title, 'body' => $n->body, 'link' => $n->link,
                'created_at' => $n->created_at->toIso8601String(),
            ]),
            'unread_notifications_count' => UserNotification::where('user_id', $user->id)->where('organization_id', $organization->id)->whereNull('read_at')->count(),
            'activity' => ActivityResource::collection($activity)->resolve($request),
        ]]);
    }
}
