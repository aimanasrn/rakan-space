<?php

namespace App\Http\Controllers\Timesheet;

use App\Http\Controllers\Controller;
use App\Http\Resources\Timesheet\TimesheetResource;
use App\Models\Approval\ApprovalAction;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Timesheet\Timesheet;
use App\Support\Permissions;
use App\Support\Timesheets\Timesheets;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** The member's own weeks, team sheets and pickers. Routes require the Timesheet app. */
class TimesheetController extends Controller
{
    /** The signed-in member's sheet for the week containing {week} (empty when nothing is logged yet). */
    public function week(Request $request, Organization $organization, string $week): JsonResponse
    {
        $start = $this->parseWeek($week);
        $timesheet = Timesheets::find($organization, $request->user(), $start);

        return response()->json(['data' => $timesheet
            ? $this->detail($timesheet, $request)
            : $this->emptyWeek($organization, $start)]);
    }

    public function saveWeek(Request $request, Organization $organization, string $week): JsonResponse
    {
        $request->validate([
            'entries' => ['present', 'array'],
            'entries.*' => ['array'],
            'entries.*.project_id' => ['nullable', 'integer'],
            'entries.*.task_id' => ['nullable', 'integer'],
            'entries.*.work_date' => ['required', 'date_format:Y-m-d'],
            'entries.*.minutes' => ['required', 'integer', 'min:0', 'max:1440'],
            'entries.*.note' => ['nullable', 'string', 'max:500'],
        ]);

        $timesheet = Timesheets::save($organization, $request->user(), $this->parseWeek($week), $request->input('entries', []));

        return response()->json(['data' => $this->detail($timesheet, $request)]);
    }

    public function submitWeek(Request $request, Organization $organization, string $week): JsonResponse
    {
        $timesheet = Timesheets::submit($organization, $request->user(), $this->parseWeek($week));

        return response()->json(['data' => $this->detail($timesheet, $request)]);
    }

    /** mine (default) | team (direct reports and sheets you approve) | all (Timesheet admins). */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'scope' => ['nullable', Rule::in(['mine', 'team', 'all'])],
            'status' => ['nullable', Rule::in(['all', 'submitted', ...Timesheet::STATUSES])],
            'week' => ['nullable', 'date_format:Y-m-d'],
            'user_id' => ['nullable', 'integer'],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $scope = $request->input('scope', 'mine');
        $query = Permissions::visibleTimesheetsQuery($user, $organization->id);

        if ($scope === 'mine') {
            $query->where('timesheets.user_id', $user->id);
        } elseif ($scope === 'team') {
            $query->where('timesheets.user_id', '!=', $user->id);
        } else {
            abort_unless(Permissions::canAdministerTimesheets($user, $organization->id), 403);
        }

        $status = $request->input('status', 'all');
        $query
            ->when($status === 'submitted', fn ($q) => $q->where('timesheets.status', '!=', Timesheet::STATUS_DRAFT))
            ->when(! in_array($status, ['all', 'submitted'], true), fn ($q) => $q->where('timesheets.status', $status))
            ->when($request->filled('week'), fn ($q) => $q->whereDate('timesheets.week_start', Timesheets::weekStart($request->input('week'))->toDateString()))
            ->when($request->filled('user_id'), fn ($q) => $q->where('timesheets.user_id', $request->integer('user_id')))
            ->when($request->filled('q'), fn ($q) => $q->whereHas('user', fn ($u) => $u
                ->where('name', 'ilike', '%'.addcslashes(trim($request->input('q')), '%_\\').'%')));

        return TimesheetResource::collection($query->with('user')
            ->orderByDesc('timesheets.week_start')->orderByDesc('timesheets.id')
            ->paginate($request->integer('per_page', 20)));
    }

    public function show(Request $request, Organization $organization, Timesheet $timesheet): JsonResponse
    {
        abort_unless(Permissions::canViewTimesheet($request->user(), $timesheet), 404);

        return response()->json(['data' => $this->detail($timesheet, $request)]);
    }

    public function withdraw(Request $request, Organization $organization, Timesheet $timesheet): JsonResponse
    {
        abort_unless(Permissions::canViewTimesheet($request->user(), $timesheet), 404);

        return response()->json(['data' => $this->detail(Timesheets::withdraw($timesheet, $request->user()), $request)]);
    }

    /** Projects the member can log time to. */
    public function projects(Request $request, Organization $organization): JsonResponse
    {
        $request->validate(['q' => ['nullable', 'string', 'max:100']]);
        $user = $request->user();

        $projects = Permissions::visibleProjectsQuery($user, $organization->id)
            ->whereNull('archived_at')
            ->when($request->filled('q'), fn ($q) => $q->where('name', 'ilike', '%'.addcslashes(trim($request->input('q')), '%_\\').'%'))
            ->with('memberships')
            ->orderBy('name')->limit(200)->get()
            ->filter(fn (Project $p) => Permissions::canLogTimeToProject($user, $p))
            ->map(fn (Project $p) => ['id' => $p->id, 'name' => $p->name])
            ->values();

        return response()->json(['data' => $projects]);
    }

    /** Tasks of a project the member can log time to; assigned and open tasks first. */
    public function tasks(Request $request, Organization $organization, Project $project): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewProject($user, $project), 404);
        abort_unless(Permissions::canLogTimeToProject($user, $project), 403);
        $request->validate(['q' => ['nullable', 'string', 'max:100']]);

        $tasks = $project->tasks()
            ->when($request->filled('q'), fn ($q) => $q->where('title', 'ilike', '%'.addcslashes(trim($request->input('q')), '%_\\').'%'))
            ->orderByRaw('case when assignee_id = ? then 0 else 1 end', [$user->id])
            ->orderByRaw("case when status = 'done' then 1 else 0 end")
            ->orderByDesc('updated_at')
            ->limit(100)->get(['id', 'title', 'status', 'assignee_id'])
            ->map(fn ($t) => ['id' => $t->id, 'title' => $t->title, 'status' => $t->status, 'assigned_to_me' => $t->assignee_id === $user->id]);

        return response()->json(['data' => $tasks]);
    }

    private function parseWeek(string $week): CarbonImmutable
    {
        try {
            $date = CarbonImmutable::createFromFormat('!Y-m-d', $week);
        } catch (\Throwable) {
            $date = false;
        }
        abort_unless($date && $date->format('Y-m-d') === $week, 404);

        return Timesheets::weekStart($date);
    }

    private function emptyWeek(Organization $organization, CarbonImmutable $start): array
    {
        return [
            'id' => null,
            'week_start' => $start->toDateString(),
            'week_end' => $start->addDays(6)->toDateString(),
            'status' => Timesheet::STATUS_DRAFT,
            'total_minutes' => 0,
            'approval_request_id' => null,
            'submitted_at' => null,
            'updated_at' => null,
            'entries' => [],
            'permissions' => ['edit' => $start->lte(Timesheets::currentWeek($organization)), 'submit' => false, 'withdraw' => false],
            'approval' => null,
        ];
    }

    private function detail(Timesheet $timesheet, Request $request): array
    {
        $timesheet->load(['user', 'entries']);
        $approval = $timesheet->approval_request_id ? ApprovalRequest::find($timesheet->approval_request_id) : null;
        $step = $approval ? ApprovalRequestStep::where('approval_request_id', $approval->id)->where('round', $approval->round)
            ->where('status', ApprovalRequestStep::STATUS_PENDING)->orderBy('position')->first() : null;
        // The approver's comment on the latest return or rejection, shown to the owner.
        $decision = $approval && in_array($approval->status, [ApprovalRequest::STATUS_RETURNED, ApprovalRequest::STATUS_REJECTED], true)
            ? ApprovalAction::where('approval_request_id', $approval->id)->whereIn('action', ['returned', 'rejected'])
                ->with('actor')->latest('id')->first()
            : null;

        return [
            ...(new TimesheetResource($timesheet))->resolve($request),
            'approval' => $approval ? [
                'id' => $approval->id,
                'status' => $approval->status,
                'current_step' => $step?->name,
                'can_view' => Permissions::canViewApprovalRequest($request->user(), $approval),
                'comment' => $decision?->comment,
                'decided_by' => $decision?->actor?->name,
            ] : null,
        ];
    }
}
