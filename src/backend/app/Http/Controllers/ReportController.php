<?php

namespace App\Http\Controllers;

use App\Enums\TaskStatus;
use App\Models\Organization;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * Basic reports. Available to Managers, Admins and Owners, and always limited
 * to projects the viewer can access (Admins/Owners: all projects).
 *
 * Project progress = completed tasks ÷ all tasks in the project (0% when the
 * project has no tasks). Overdue = not done and due date before today in the
 * organisation time zone.
 */
class ReportController extends Controller
{
    public function __invoke(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewReports($user, $organization->id), 403, 'Reports are available to managers, admins and owners.');
        $request->validate(['days' => ['nullable', 'integer', 'in:7,30,90,365']]);

        $days = $request->integer('days', 30);
        $today = now($organization->timezone)->toDateString();
        $since = now()->subDays($days);
        $projectIds = Permissions::visibleProjectsQuery($user, $organization->id)->whereNull('archived_at')->pluck('id');

        $tasks = DB::table('tasks')->where('tasks.organization_id', $organization->id)->whereIn('tasks.project_id', $projectIds);

        $byStatus = (clone $tasks)->select('status', DB::raw('count(*) as total'))->groupBy('status')->pluck('total', 'status');

        $completedTrend = (clone $tasks)->where('status', 'done')->where('completed_at', '>=', $since)
            ->selectRaw("to_char(date_trunc('day', completed_at AT TIME ZONE 'UTC' AT TIME ZONE ?), 'YYYY-MM-DD') as day, count(*) as total", [$organization->timezone])
            ->groupBy('day')->orderBy('day')->pluck('total', 'day');

        $projects = DB::table('projects')->whereIn('projects.id', $projectIds)
            ->leftJoin('tasks', 'tasks.project_id', '=', 'projects.id')
            ->groupBy('projects.id', 'projects.name', 'projects.status', 'projects.target_date')
            ->select('projects.id', 'projects.name', 'projects.status', 'projects.target_date')
            ->selectRaw('count(tasks.id) as total')
            ->selectRaw("count(tasks.id) filter (where tasks.status = 'done') as done")
            ->selectRaw("count(tasks.id) filter (where tasks.status <> 'done' and tasks.due_date < ?) as overdue", [$today])
            ->orderBy('projects.name')->get()
            ->map(fn ($p) => [
                'id' => $p->id,
                'name' => $p->name,
                'status' => $p->status,
                'target_date' => $p->target_date,
                'total' => (int) $p->total,
                'done' => (int) $p->done,
                'overdue' => (int) $p->overdue,
                'percent' => $p->total > 0 ? (int) round($p->done * 100 / $p->total) : 0,
            ]);

        $overdueTasks = (clone $tasks)->where('tasks.status', '!=', 'done')->where('tasks.due_date', '<', $today)
            ->leftJoin('users', 'users.id', '=', 'tasks.assignee_id')
            ->join('projects', 'projects.id', '=', 'tasks.project_id')
            ->orderBy('tasks.due_date')->limit(25)
            ->get(['tasks.id', 'tasks.title', 'tasks.due_date', 'tasks.priority', 'tasks.project_id', 'projects.name as project_name', 'users.name as assignee_name']);

        return response()->json(['data' => [
            'range_days' => $days,
            'timezone' => $organization->timezone,
            'totals' => [
                'tasks' => (int) $byStatus->sum(),
                'completed' => (int) ($byStatus['done'] ?? 0),
                'completed_in_range' => (int) $completedTrend->sum(),
                'overdue' => (clone $tasks)->where('status', '!=', 'done')->where('due_date', '<', $today)->count(),
                'projects' => $projectIds->count(),
            ],
            'by_status' => collect(TaskStatus::cases())->map(fn ($s) => [
                'status' => $s->value, 'label' => $s->label(), 'total' => (int) ($byStatus[$s->value] ?? 0),
            ]),
            'completed_trend' => $completedTrend->map(fn ($v, $k) => ['day' => $k, 'total' => (int) $v])->values(),
            'projects' => $projects,
            'overdue_tasks' => $overdueTasks,
        ]]);
    }
}
