<?php

namespace App\Http\Controllers\Approval;

use App\Http\Controllers\Controller;
use App\Http\Resources\Approval\DelegationResource;
use App\Models\Approval\ApprovalAction;
use App\Models\Approval\ApprovalDelegation;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Approval\ApprovalStepApprover;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Notifier;
use Carbon\Carbon;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Out-of-office delegation. Members manage their own; the delegator is always
 * the signed-in user (never taken from the request).
 */
class DelegationController extends Controller
{
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate(['scope' => ['nullable', Rule::in(['mine', 'to_me'])]]);
        $user = $request->user();
        $column = $request->input('scope') === 'to_me' ? 'delegate_id' : 'delegator_id';

        $items = $organization->approvalDelegations()->with(['delegator', 'delegate'])
            ->where($column, $user->id)
            ->orderByDesc('starts_at')->limit(100)->get();

        return DelegationResource::collection($items);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $data = $request->validate([
            'delegate_id' => ['required', 'integer'],
            'starts_at' => ['required', 'date'],
            'ends_at' => ['required', 'date', 'after:starts_at', 'after:now'],
            'reason' => ['nullable', 'string', 'max:255'],
        ]);
        $delegateId = (int) $data['delegate_id'];
        if ($delegateId === $user->id || $organization->filterActiveMemberIds([$delegateId]) === []) {
            throw ValidationException::withMessages(['delegate_id' => 'Choose another active member of this workspace.']);
        }
        $starts = Carbon::parse($data['starts_at']);
        $ends = Carbon::parse($data['ends_at']);

        $delegation = DB::transaction(function () use ($organization, $user, $delegateId, $starts, $ends, $data) {
            $overlap = ApprovalDelegation::where('organization_id', $organization->id)->where('delegator_id', $user->id)
                ->whereNull('revoked_at')->where('starts_at', '<', $ends)->where('ends_at', '>', $starts)->lockForUpdate()->exists();
            if ($overlap) {
                throw ValidationException::withMessages(['starts_at' => 'You already have a delegation during this period.']);
            }

            $delegation = ApprovalDelegation::create([
                'organization_id' => $organization->id, 'delegator_id' => $user->id, 'delegate_id' => $delegateId,
                'starts_at' => $starts, 'ends_at' => $ends, 'reason' => $data['reason'] ?? null,
            ]);

            // Already active: hand over approvals currently waiting for the delegator.
            if ($starts->lte(now())) {
                $this->handOver($organization->id, $user->id, $delegateId);
            }
            ActivityLog::audit($organization->id, $user, 'approval.delegation_created', null, ['delegate_id' => $delegateId]);

            return $delegation;
        });

        Notifier::send($organization->id, [$delegateId], 'approval.delegated',
            $user->name.' delegated approvals to you',
            $starts->toDayDateTimeString().' – '.$ends->toDayDateTimeString().' (UTC)',
            '/apps/approval', $user->id, 'approval-delegation:'.$delegation->id);

        return response()->json(['data' => new DelegationResource($delegation->load(['delegator', 'delegate']))], 201);
    }

    public function destroy(Request $request, Organization $organization, ApprovalDelegation $approvalDelegation): JsonResponse
    {
        // Other people's delegations are not revealed.
        abort_unless($approvalDelegation->delegator_id === $request->user()->id, 404);
        abort_if($approvalDelegation->revoked_at || $approvalDelegation->ends_at->lte(now()), 422, 'This delegation has already ended.');

        $approvalDelegation->update(['revoked_at' => now()]);
        ActivityLog::audit($organization->id, $request->user(), 'approval.delegation_revoked', null, ['delegate_id' => $approvalDelegation->delegate_id]);

        return response()->json(['data' => new DelegationResource($approvalDelegation->load(['delegator', 'delegate']))]);
    }

    /** Moves the delegator's undecided approvals on active steps to the delegate. */
    private function handOver(int $organizationId, int $delegatorId, int $delegateId): void
    {
        $rows = ApprovalStepApprover::where('organization_id', $organizationId)
            ->where('user_id', $delegatorId)->whereNull('decision')
            ->whereHas('step', fn ($q) => $q->where('status', ApprovalRequestStep::STATUS_PENDING))
            ->with('step.request')->get();

        foreach ($rows as $row) {
            $request = $row->step->request;
            if (! $request || ! $request->isOpen() || $request->requester_id === $delegateId) {
                continue;
            }
            $alreadyThere = ApprovalStepApprover::where('approval_request_step_id', $row->approval_request_step_id)
                ->where('user_id', $delegateId)->exists();
            $alreadyThere ? $row->delete() : $row->update(['user_id' => $delegateId, 'delegated_from' => $delegatorId]);

            ApprovalAction::create([
                'organization_id' => $organizationId,
                'approval_request_id' => $request->id,
                'approval_request_step_id' => $row->approval_request_step_id,
                'actor_id' => $delegatorId,
                'action' => 'delegated',
                'properties' => ['round' => $request->round, 'from' => $delegatorId, 'to' => $delegateId],
            ]);
            Notifier::send($organizationId, [$delegateId], 'approval.requested',
                'Approval needed: '.$request->title, $row->step->name.' · delegated to you',
                '/apps/approval/requests/'.$request->id, $delegatorId, 'approval-step:'.$row->approval_request_step_id.':'.$delegateId,
                ['approval_request_id' => $request->id], email: true);
        }
    }
}
