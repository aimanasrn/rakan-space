<?php

namespace App\Http\Controllers\Approval;

use App\Enums\AppAbility;
use App\Http\Controllers\Controller;
use App\Http\Resources\Approval\ApprovalRequestResource;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Organization;
use App\Support\Approvals\Approvals;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Validation\Rule;

/**
 * Inbox, "my requests" and decisions. Being a requester or approver is enough;
 * the Approval app ability is only needed for manual requests and the "all" view.
 */
class RequestController extends Controller
{
    public const MANUAL = 'manual';

    private const LIST_WITH = ['requester', 'workflow', 'allSteps.assignees.user'];

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'box' => ['nullable', Rule::in(['inbox', 'mine', 'decided', 'all'])],
            'status' => ['nullable', Rule::in(['pending', 'approved', 'rejected', 'returned', 'cancelled', 'all'])],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $box = $request->input('box', 'inbox');
        abort_if($box === 'all' && ! Permissions::canManageApprovalWorkflows($user, $organization->id), 403);

        $query = Permissions::visibleApprovalRequestsQuery($user, $organization->id)
            ->with(self::LIST_WITH)
            ->when($box === 'inbox', fn (Builder $q) => $this->whereMyTurn($q, $user->id))
            ->when($box === 'mine', fn (Builder $q) => $q->where('requester_id', $user->id))
            ->when($box === 'decided', fn (Builder $q) => $q->whereExists(fn ($sub) => $sub->selectRaw('1')->from('approval_step_approvers')
                ->whereColumn('approval_step_approvers.approval_request_id', 'approval_requests.id')
                ->where('approval_step_approvers.user_id', $user->id)
                ->whereNotNull('approval_step_approvers.decision')))
            ->when($request->filled('status') && $request->input('status') !== 'all', fn ($q) => $q->where('status', $request->input('status')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('title', 'ilike', $term)->orWhere('summary', 'ilike', $term));
            })
            ->orderByDesc('submitted_at')->orderByDesc('id');

        return ApprovalRequestResource::collection($query->paginate($request->integer('per_page', 20)));
    }

    /** Counts for the Approval dashboard and badges. */
    public function summary(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $visible = fn () => Permissions::visibleApprovalRequestsQuery($user, $organization->id);

        return response()->json(['data' => [
            'inbox' => $this->whereMyTurn($visible(), $user->id)->count(),
            'my_pending' => $visible()->where('requester_id', $user->id)->where('status', ApprovalRequest::STATUS_PENDING)->count(),
            'my_returned' => $visible()->where('requester_id', $user->id)->where('status', ApprovalRequest::STATUS_RETURNED)->count(),
            'overdue' => $this->whereMyTurn($visible(), $user->id, overdue: true)->count(),
            'can_create' => Permissions::hasAppAbility($user, $organization->id, 'approval', AppAbility::Create),
            'can_manage' => Permissions::canManageApprovalWorkflows($user, $organization->id),
        ]]);
    }

    /** A request made directly in the Approval app (not from another module). */
    public function store(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::hasAppAbility($request->user(), $organization->id, 'approval', AppAbility::Create), 403, 'You cannot create approval requests.');
        $data = $request->validate([
            'workflow_id' => ['required', 'integer'],
            'title' => ['required', 'string', 'min:3', 'max:200'],
            'details' => ['nullable', 'string', 'max:1000'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:1000000000'],
        ]);
        $workflow = $organization->approvalWorkflows()->whereKey($data['workflow_id'])->first();
        abort_unless($workflow, 422, 'Choose a workflow from this workspace.');

        $approval = Approvals::submitForApproval(
            $organization, $request->user(), self::MANUAL, null, $workflow, $data['title'],
            array_filter(['amount' => $data['amount'] ?? null], fn ($v) => $v !== null),
            $data['details'] ?? null,
        );

        return response()->json(['data' => $this->detail($approval)], 201);
    }

    public function show(Request $request, Organization $organization, ApprovalRequest $approvalRequest): JsonResponse
    {
        $this->authorizeView($request, $approvalRequest);

        return response()->json(['data' => $this->detail($approvalRequest)]);
    }

    public function decide(Request $request, Organization $organization, ApprovalRequest $approvalRequest): JsonResponse
    {
        $this->authorizeView($request, $approvalRequest);
        $data = $request->validate([
            'decision' => ['required', Rule::in(Approvals::DECISIONS)],
            'comment' => ['nullable', 'string', 'max:2000'],
        ]);

        $updated = Approvals::decide($approvalRequest, $request->user(), $data['decision'], $data['comment'] ?? null);

        return response()->json(['data' => $this->detail($updated)]);
    }

    /** Manual requests only; module requests are resubmitted from their module (e.g. the form). */
    public function resubmit(Request $request, Organization $organization, ApprovalRequest $approvalRequest): JsonResponse
    {
        $this->authorizeView($request, $approvalRequest);
        abort_unless($approvalRequest->entity_type === self::MANUAL, 422, 'Change and resubmit this from where it was created.');
        $data = $request->validate([
            'title' => ['required', 'string', 'min:3', 'max:200'],
            'details' => ['nullable', 'string', 'max:1000'],
            'amount' => ['nullable', 'numeric', 'min:0', 'max:1000000000'],
        ]);
        $updated = Approvals::resubmit($approvalRequest, $request->user(),
            array_filter(['amount' => $data['amount'] ?? null], fn ($v) => $v !== null), $data['title'], $data['details'] ?? null);

        return response()->json(['data' => $this->detail($updated)]);
    }

    public function cancel(Request $request, Organization $organization, ApprovalRequest $approvalRequest): JsonResponse
    {
        $this->authorizeView($request, $approvalRequest);
        $data = $request->validate(['comment' => ['nullable', 'string', 'max:2000']]);

        return response()->json(['data' => $this->detail(Approvals::cancel($approvalRequest, $request->user(), $data['comment'] ?? null))]);
    }

    private function whereMyTurn(Builder $query, int $userId, bool $overdue = false): Builder
    {
        return $query->where('approval_requests.status', ApprovalRequest::STATUS_PENDING)
            ->whereExists(fn ($sub) => $sub->selectRaw('1')->from('approval_step_approvers')
                ->join('approval_request_steps', 'approval_request_steps.id', '=', 'approval_step_approvers.approval_request_step_id')
                ->whereColumn('approval_step_approvers.approval_request_id', 'approval_requests.id')
                ->whereColumn('approval_request_steps.round', 'approval_requests.round')
                ->where('approval_request_steps.status', ApprovalRequestStep::STATUS_PENDING)
                ->where('approval_step_approvers.user_id', $userId)
                ->whereNull('approval_step_approvers.decision')
                ->when($overdue, fn ($q) => $q->whereNotNull('approval_request_steps.sla_hours')
                    ->whereRaw("approval_request_steps.activated_at + (approval_request_steps.sla_hours || ' hours')::interval < now()")));
    }

    private function detail(ApprovalRequest $approval): array
    {
        $approval->load([...self::LIST_WITH, 'allSteps.assignees.delegator', 'actions.actor']);

        return (new ApprovalRequestResource($approval))->withDetail()->resolve(request());
    }

    /** Not a participant → 404 (existence is not revealed). */
    private function authorizeView(Request $request, ApprovalRequest $approvalRequest): void
    {
        abort_unless(Permissions::canViewApprovalRequest($request->user(), $approvalRequest), 404);
    }
}
