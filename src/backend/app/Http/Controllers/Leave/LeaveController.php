<?php

namespace App\Http\Controllers\Leave;

use App\Http\Controllers\Controller;
use App\Http\Resources\Leave\LeaveRequestResource;
use App\Http\Resources\UserSummaryResource;
use App\Models\Approval\ApprovalAction;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Leave\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Support\Leave\Leaves;
use App\Support\Permissions;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/** Balances, applications and the leave calendar. Routes require the Leave app. */
class LeaveController extends Controller
{
    /** Eligible, taken, pending and balance per leave type (the signed-in member, or a member they may see). */
    public function summary(Request $request, Organization $organization): JsonResponse
    {
        $request->validate([
            'year' => ['nullable', 'integer', 'min:2000', 'max:2100'],
            'user_id' => ['nullable', 'integer'],
        ]);
        $user = $request->user();
        $memberId = $request->filled('user_id') ? $request->integer('user_id') : $user->id;
        // Same answer for "not a member" and "not yours to see".
        abort_unless(in_array($memberId, $organization->filterActiveMemberIds([$memberId]), true)
            && Permissions::canViewLeaveBalances($user, $organization->id, $memberId), 404);
        $today = Leaves::today($organization);
        $year = $request->filled('year') ? $request->integer('year') : $today->year;

        return response()->json(['data' => [
            'year' => $year,
            'today' => $today->toDateString(),
            'user' => new UserSummaryResource(User::findOrFail($memberId)),
            'types' => Leaves::balances($organization, $memberId, $year),
        ]]);
    }

    /** mine (default) | team (direct reports and applications you approve) | all (Leave admins). */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'scope' => ['nullable', Rule::in(['mine', 'team', 'all'])],
            'status' => ['nullable', Rule::in(['all', 'open', ...LeaveRequest::STATUSES])],
            'year' => ['nullable', 'integer', 'min:2000', 'max:2100'],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $scope = $request->input('scope', 'mine');
        $query = Permissions::visibleLeaveRequestsQuery($user, $organization->id);

        if ($scope === 'mine') {
            $query->where('leave_requests.user_id', $user->id);
        } elseif ($scope === 'team') {
            $query->where('leave_requests.user_id', '!=', $user->id);
        } else {
            abort_unless(Permissions::canAdministerLeave($user, $organization->id), 403);
        }

        $status = $request->input('status', 'all');
        $query
            ->when($status === 'open', fn ($q) => $q->whereIn('leave_requests.status', LeaveRequest::OPEN))
            ->when(! in_array($status, ['all', 'open'], true), fn ($q) => $q->where('leave_requests.status', $status))
            ->when($request->filled('year'), fn ($q) => $q->whereYear('leave_requests.start_date', $request->integer('year')))
            ->when($request->filled('q'), fn ($q) => $q->whereHas('user', fn ($u) => $u
                ->where('name', 'ilike', '%'.addcslashes(trim($request->input('q')), '%_\\').'%')));

        return LeaveRequestResource::collection($query->with(['user', 'type'])
            ->orderByDesc('leave_requests.start_date')->orderByDesc('leave_requests.id')
            ->paginate($request->integer('per_page', 20)));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $request->validate($this->rules());
        $leave = Leaves::apply($organization, $request->user(), $request->only(['leave_type_id', 'start_date', 'end_date', 'half_day', 'reason']));

        return response()->json(['data' => $this->detail($leave, $request)], 201);
    }

    public function show(Request $request, Organization $organization, LeaveRequest $leaveRequest): JsonResponse
    {
        abort_unless(Permissions::canViewLeaveRequest($request->user(), $leaveRequest), 404);

        return response()->json(['data' => $this->detail($leaveRequest, $request)]);
    }

    /** Change an application that was returned for changes, and send it again. */
    public function update(Request $request, Organization $organization, LeaveRequest $leaveRequest): JsonResponse
    {
        abort_unless(Permissions::canViewLeaveRequest($request->user(), $leaveRequest), 404);
        $request->validate($this->rules());
        $leave = Leaves::resubmit($organization, $leaveRequest, $request->user(), $request->only(['leave_type_id', 'start_date', 'end_date', 'half_day', 'reason']));

        return response()->json(['data' => $this->detail($leave, $request)]);
    }

    public function cancel(Request $request, Organization $organization, LeaveRequest $leaveRequest): JsonResponse
    {
        abort_unless(Permissions::canViewLeaveRequest($request->user(), $leaveRequest), 404);

        return response()->json(['data' => $this->detail(Leaves::cancel($organization, $leaveRequest, $request->user()), $request)]);
    }

    /**
     * Who is on leave in a month. Everyone with the app sees approved leave of
     * active members (name and dates). The leave type and applications still
     * waiting for a decision are included only where the viewer may see the
     * application. scope=team narrows it to the viewer and their direct reports.
     */
    public function calendar(Request $request, Organization $organization): JsonResponse
    {
        $request->validate([
            'month' => ['nullable', 'date_format:Y-m'],
            'scope' => ['nullable', Rule::in(['everyone', 'team', 'mine'])],
        ]);
        $user = $request->user();
        $start = $request->filled('month')
            ? CarbonImmutable::createFromFormat('!Y-m', $request->input('month'))
            : Leaves::today($organization)->startOfMonth();
        $end = $start->endOfMonth()->startOfDay();
        $scope = $request->input('scope', 'everyone');

        $overlapping = fn ($q) => $q->whereDate('leave_requests.start_date', '<=', $end->toDateString())
            ->whereDate('leave_requests.end_date', '>=', $start->toDateString());
        $visible = $overlapping(Permissions::visibleLeaveRequestsQuery($user, $organization->id))
            ->whereIn('leave_requests.status', LeaveRequest::HOLDS_DATES)
            ->pluck('leave_requests.id')->flip();

        $rows = $overlapping(LeaveRequest::query()->where('leave_requests.organization_id', $organization->id))
            ->where(fn ($q) => $q->where('leave_requests.status', LeaveRequest::STATUS_APPROVED)
                ->orWhereIn('leave_requests.id', $visible->keys()->all()))
            ->whereIn('leave_requests.user_id', $organization->activeMemberships()->select('user_id'))
            ->when($scope === 'mine', fn ($q) => $q->where('leave_requests.user_id', $user->id))
            ->when($scope === 'team', fn ($q) => $q->where(fn ($w) => $w->where('leave_requests.user_id', $user->id)
                ->orWhereIn('leave_requests.user_id', Permissions::directReportIdsQuery($user, $organization->id))))
            ->with(['user', 'type'])
            ->orderBy('leave_requests.start_date')->orderBy('leave_requests.id')
            ->limit(1000)->get();

        return response()->json(['data' => [
            'month' => $start->format('Y-m'),
            'today' => Leaves::today($organization)->toDateString(),
            'entries' => $rows->map(function (LeaveRequest $leave) use ($visible) {
                $canView = $visible->has($leave->id);

                return [
                    'id' => $leave->id,
                    'user' => new UserSummaryResource($leave->user),
                    'start_date' => $leave->start_date->toDateString(),
                    'end_date' => $leave->end_date->toDateString(),
                    'half_day' => $leave->half_day,
                    'days' => $leave->days,
                    'status' => $leave->status,
                    // Everyone else only sees that the person is away.
                    'type' => $canView ? ['id' => $leave->type->id, 'name' => $leave->type->name, 'color' => $leave->type->color] : null,
                    'can_view' => $canView,
                ];
            })->values(),
        ]]);
    }

    private function rules(): array
    {
        return [
            'leave_type_id' => ['required', 'integer'],
            'start_date' => ['required', 'date_format:Y-m-d'],
            'end_date' => ['required', 'date_format:Y-m-d'],
            'half_day' => ['nullable', Rule::in(LeaveRequest::HALF_DAYS)],
            'reason' => ['nullable', 'string', 'max:1000'],
        ];
    }

    private function detail(LeaveRequest $leave, Request $request): array
    {
        $leave->loadMissing(['user', 'type']);
        $approval = $leave->approval_request_id ? ApprovalRequest::find($leave->approval_request_id) : null;
        $step = $approval ? ApprovalRequestStep::where('approval_request_id', $approval->id)->where('round', $approval->round)
            ->where('status', ApprovalRequestStep::STATUS_PENDING)->orderBy('position')->first() : null;
        // The approver's comment on the latest decision, shown to the applicant.
        $decision = $approval
            ? ApprovalAction::where('approval_request_id', $approval->id)->whereIn('action', ['approved', 'returned', 'rejected'])
                ->with('actor')->latest('id')->first()
            : null;

        return [
            ...(new LeaveRequestResource($leave))->resolve($request),
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
