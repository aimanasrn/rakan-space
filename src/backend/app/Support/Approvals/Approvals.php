<?php

namespace App\Support\Approvals;

use App\Events\ApprovalRequestStatusChanged;
use App\Models\Approval\ApprovalAction;
use App\Models\Approval\ApprovalDelegation;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalRequestStep;
use App\Models\Approval\ApprovalStepApprover;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Approval\ApprovalWorkflowStep;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\User;
use App\Support\Conditions;
use App\Support\Notifier;
use App\Support\ReportingLine;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Generic approval engine used by every module.
 *
 *   Approvals::submitForApproval($org, $user, 'form_submission', $id, $workflow, 'Title', $data);
 *
 * Steps run in order. Each step resolves its approvers when it starts (so
 * delegations and reporting lines are current), needs one ("any") or every
 * ("all") approver to approve, and is skipped when its condition does not
 * match the request data. Modules react to ApprovalRequestStatusChanged.
 */
class Approvals
{
    public const DECISIONS = ['approve', 'reject', 'return'];

    /**
     * @param  array<string, mixed>  $data  Values for step conditions and display (e.g. amount).
     * @param  string|null  $link  Workspace-relative path to the item being approved.
     */
    public static function submitForApproval(
        Organization $organization,
        User $requester,
        string $entityType,
        ?int $entityId,
        ApprovalWorkflow $workflow,
        string $title,
        array $data = [],
        ?string $summary = null,
        ?string $link = null,
    ): ApprovalRequest {
        if ($workflow->organization_id !== $organization->id) {
            throw new HttpException(404);
        }
        if (! $workflow->is_active) {
            throw ValidationException::withMessages(['workflow_id' => 'This workflow is turned off.']);
        }
        if (! $workflow->steps()->exists()) {
            throw ValidationException::withMessages(['workflow_id' => 'This workflow has no steps.']);
        }

        return DB::transaction(function () use ($organization, $requester, $entityType, $entityId, $workflow, $title, $data, $summary, $link) {
            $request = ApprovalRequest::create([
                'organization_id' => $organization->id,
                'workflow_id' => $workflow->id,
                'requester_id' => $requester->id,
                'entity_type' => $entityType,
                'entity_id' => $entityId,
                'title' => mb_substr($title, 0, 200),
                'summary' => $summary !== null ? mb_substr($summary, 0, 1000) : null,
                'data' => $data ?: null,
                'link' => $link,
                'submitted_at' => now(),
            ]);
            self::log($request, $requester, 'submitted');
            self::startRound($request, $workflow);

            return $request->fresh();
        });
    }

    /** Approve, reject or return the current step. Reject and return need a comment. */
    public static function decide(ApprovalRequest $request, User $actor, string $decision, ?string $comment = null): ApprovalRequest
    {
        if (! in_array($decision, self::DECISIONS, true)) {
            throw ValidationException::withMessages(['decision' => 'Unknown decision.']);
        }
        $comment = $comment !== null ? trim($comment) : null;
        if ($decision !== 'approve' && ! $comment) {
            throw ValidationException::withMessages(['comment' => 'Please add a comment explaining your decision.']);
        }

        return DB::transaction(function () use ($request, $actor, $decision, $comment) {
            $request = ApprovalRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            if (! $request->isOpen()) {
                throw new HttpException(422, 'This request is no longer waiting for a decision.');
            }

            $step = self::currentStep($request);
            $row = $step?->assignees()->where('user_id', $actor->id)->whereNull('decision')->first();
            if (! $step || ! $row) {
                throw new HttpException(403, 'You are not an approver for the current step.');
            }

            $row->update(['decision' => self::pastTense($decision), 'comment' => $comment, 'decided_at' => now()]);
            self::log($request, $actor, self::pastTense($decision), $step, $comment);

            if ($decision === 'reject') {
                $step->update(['status' => ApprovalRequestStep::STATUS_REJECTED, 'completed_at' => now()]);
                self::finish($request, ApprovalRequest::STATUS_REJECTED, $actor, $comment);
            } elseif ($decision === 'return') {
                $step->update(['status' => ApprovalRequestStep::STATUS_RETURNED, 'completed_at' => now()]);
                self::finish($request, ApprovalRequest::STATUS_RETURNED, $actor, $comment);
            } elseif (self::stepIsApproved($step)) {
                $step->update(['status' => ApprovalRequestStep::STATUS_APPROVED, 'completed_at' => now()]);
                self::advance($request, $actor);
            }

            return $request->fresh();
        });
    }

    /** The requester sends a returned request again; approval starts from the first step. */
    public static function resubmit(ApprovalRequest $request, User $actor, ?array $data = null, ?string $title = null, ?string $summary = null): ApprovalRequest
    {
        return DB::transaction(function () use ($request, $actor, $data, $title, $summary) {
            $request = ApprovalRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            if ($request->requester_id !== $actor->id) {
                throw new HttpException(403, 'Only the requester can resubmit.');
            }
            if ($request->status !== ApprovalRequest::STATUS_RETURNED) {
                throw new HttpException(422, 'Only returned requests can be resubmitted.');
            }
            $workflow = $request->workflow;
            if (! $workflow || ! $workflow->is_active || ! $workflow->steps()->exists()) {
                throw new HttpException(422, 'The workflow for this request is no longer available.');
            }

            $request->update(array_filter([
                'data' => $data,
                'title' => $title !== null ? mb_substr($title, 0, 200) : null,
                'summary' => $summary,
            ], fn ($v) => $v !== null) + [
                'status' => ApprovalRequest::STATUS_PENDING,
                'round' => $request->round + 1,
                'completed_at' => null,
            ]);
            self::log($request, $actor, 'resubmitted');
            self::dispatchStatus($request);
            self::startRound($request, $workflow);

            return $request->fresh();
        });
    }

    /** The requester withdraws a pending or returned request. */
    public static function cancel(ApprovalRequest $request, User $actor, ?string $comment = null): ApprovalRequest
    {
        return DB::transaction(function () use ($request, $actor, $comment) {
            $request = ApprovalRequest::whereKey($request->id)->lockForUpdate()->firstOrFail();
            if ($request->requester_id !== $actor->id) {
                throw new HttpException(403, 'Only the requester can withdraw this request.');
            }
            if (! in_array($request->status, [ApprovalRequest::STATUS_PENDING, ApprovalRequest::STATUS_RETURNED], true)) {
                throw new HttpException(422, 'This request can no longer be withdrawn.');
            }
            self::finish($request, ApprovalRequest::STATUS_CANCELLED, $actor, $comment);

            return $request->fresh();
        });
    }

    /**
     * Reminds approvers when a step passes its SLA and escalates at twice the SLA.
     * Each step is reminded and escalated at most once, even across overlapping runs.
     *
     * @return array{reminded: int, escalated: int}
     */
    public static function processSla(?CarbonInterface $now = null): array
    {
        $now ??= now();
        $reminded = 0;
        $escalated = 0;

        ApprovalRequestStep::query()
            ->where('status', ApprovalRequestStep::STATUS_PENDING)
            ->whereNotNull('sla_hours')
            ->whereNotNull('activated_at')
            ->with('request')
            ->chunkById(200, function ($steps) use ($now, &$reminded, &$escalated) {
                foreach ($steps as $step) {
                    $due = $step->dueAt();
                    if (! $due || $due->gt($now) || ! $step->request?->isOpen()) {
                        continue;
                    }

                    // Claim the reminder atomically so parallel runs do not double-send.
                    if (! $step->reminded_at && ApprovalRequestStep::whereKey($step->id)->whereNull('reminded_at')->update(['reminded_at' => $now])) {
                        self::remind($step);
                        $reminded++;
                    }

                    $escalateAt = $step->activated_at->copy()->addHours($step->sla_hours * 2);
                    if ($step->escalate_to && ! $step->escalated_at && $escalateAt->lte($now)
                        && ApprovalRequestStep::whereKey($step->id)->whereNull('escalated_at')->update(['escalated_at' => $now])) {
                        self::escalate($step);
                        $escalated++;
                    }
                }
            });

        return ['reminded' => $reminded, 'escalated' => $escalated];
    }

    /**
     * A member left the organisation: drop their open approval tasks there so
     * nothing waits on them. A step left without approvers goes to Owners/Admins.
     * Their decisions, requests and history are kept.
     */
    public static function removeMember(int $organizationId, int $userId): void
    {
        $rows = ApprovalStepApprover::where('organization_id', $organizationId)
            ->where('user_id', $userId)->whereNull('decision')
            ->whereHas('step', fn ($q) => $q->where('status', ApprovalRequestStep::STATUS_PENDING))
            ->get();

        foreach ($rows as $row) {
            $request = ApprovalRequest::whereKey($row->approval_request_id)->lockForUpdate()->first();
            $step = ApprovalRequestStep::find($row->approval_request_step_id);
            if (! $request || ! $step || ! $request->isOpen()) {
                continue;
            }

            $row->delete();
            self::log($request, null, 'approver_removed', $step, null, ['user_id' => $userId]);

            if ($step->assignees()->exists()) {
                if (self::stepIsApproved($step)) {
                    $step->update(['status' => ApprovalRequestStep::STATUS_APPROVED, 'completed_at' => now()]);
                    self::advance($request, null);
                }

                continue;
            }

            $fallback = OrganizationMembership::where('organization_id', $organizationId)
                ->where('status', OrganizationMembership::STATUS_ACTIVE)
                ->whereIn('role', ['owner', 'admin'])
                ->whereNotIn('user_id', [$userId, $request->requester_id])
                ->pluck('user_id');
            foreach ($fallback as $id) {
                ApprovalStepApprover::create([
                    'organization_id' => $organizationId, 'approval_request_id' => $request->id,
                    'approval_request_step_id' => $step->id, 'user_id' => $id, 'source' => 'fallback',
                ]);
            }
            Notifier::send($organizationId, $fallback, 'approval.requested', 'Approval needed: '.$request->title,
                $step->name.' · reassigned because an approver left', self::link($request), null,
                'approval-step:'.$step->id.':reassigned', ['approval_request_id' => $request->id], email: true);
        }
    }

    /** The pending step of the current round, if any. */
    public static function currentStep(ApprovalRequest $request): ?ApprovalRequestStep
    {
        return ApprovalRequestStep::where('approval_request_id', $request->id)
            ->where('round', $request->round)
            ->where('status', ApprovalRequestStep::STATUS_PENDING)
            ->orderBy('position')->first();
    }

    /**
     * Who would approve a step for this requester right now.
     *
     * @return list<array{user_id: int, source: string, delegated_from: int|null}>
     */
    public static function resolveApprovers(int $organizationId, array $definitions, int $requesterId, ?CarbonInterface $at = null): array
    {
        $at ??= now();
        $found = [];
        foreach ($definitions as $def) {
            $type = $def['type'] ?? null;
            $ids = match ($type) {
                'user' => isset($def['user_id']) ? [(int) $def['user_id']] : [],
                'role' => OrganizationMembership::where('organization_id', $organizationId)
                    ->where('status', OrganizationMembership::STATUS_ACTIVE)
                    ->where('role', $def['role'] ?? '')->pluck('user_id')->all(),
                'manager' => array_filter([ReportingLine::managerOf($organizationId, $requesterId)]),
                default => [],
            };
            foreach ($ids as $id) {
                $found[(int) $id] ??= $type;
            }
        }

        $active = self::activeMemberIds($organizationId, array_keys($found));
        $found = array_filter($found, fn ($source, $id) => $id !== $requesterId && in_array($id, $active, true), ARRAY_FILTER_USE_BOTH);

        // Nobody available: Owners and Admins approve instead, so nothing is approved by default.
        if ($found === []) {
            $fallback = OrganizationMembership::where('organization_id', $organizationId)
                ->where('status', OrganizationMembership::STATUS_ACTIVE)
                ->whereIn('role', ['owner', 'admin'])
                ->where('user_id', '!=', $requesterId)
                ->pluck('user_id');
            foreach ($fallback as $id) {
                $found[(int) $id] = 'fallback';
            }
        }

        // Out-of-office delegations active at this moment.
        $delegations = ApprovalDelegation::where('organization_id', $organizationId)
            ->whereIn('delegator_id', array_keys($found))
            ->activeAt($at)->orderBy('id')->get()->keyBy('delegator_id');
        $delegateIds = self::activeMemberIds($organizationId, $delegations->pluck('delegate_id')->all());

        $result = [];
        foreach ($found as $userId => $source) {
            $delegation = $delegations->get($userId);
            $delegate = $delegation?->delegate_id;
            if ($delegate && $delegate !== $requesterId && in_array($delegate, $delegateIds, true)) {
                $result[$delegate] ??= ['user_id' => $delegate, 'source' => $source, 'delegated_from' => $userId];
            } else {
                $result[$userId] ??= ['user_id' => $userId, 'source' => $source, 'delegated_from' => null];
            }
        }

        return array_values($result);
    }

    // ---------------------------------------------------------------- internals

    private static function startRound(ApprovalRequest $request, ApprovalWorkflow $workflow): void
    {
        foreach ($workflow->steps()->get() as $def) {
            /** @var ApprovalWorkflowStep $def */
            ApprovalRequestStep::create([
                'organization_id' => $request->organization_id,
                'approval_request_id' => $request->id,
                'round' => $request->round,
                'position' => $def->position,
                'name' => $def->name,
                'mode' => $def->mode,
                'approvers' => $def->approvers,
                'condition' => $def->condition,
                'sla_hours' => $def->sla_hours,
                'escalate_to' => $def->escalate_to,
            ]);
        }

        self::advance($request, null);
    }

    /** Starts the next step whose condition matches, or approves the request when none is left. */
    private static function advance(ApprovalRequest $request, ?User $actor): void
    {
        $waiting = ApprovalRequestStep::where('approval_request_id', $request->id)
            ->where('round', $request->round)
            ->where('status', ApprovalRequestStep::STATUS_WAITING)
            ->orderBy('position')->get();

        foreach ($waiting as $step) {
            if (! Conditions::matches($step->condition, $request->data ?? [])) {
                $step->update(['status' => ApprovalRequestStep::STATUS_SKIPPED, 'completed_at' => now()]);
                self::log($request, null, 'skipped', $step, null, ['reason' => 'condition']);

                continue;
            }

            $approvers = self::resolveApprovers($request->organization_id, $step->approvers ?? [], $request->requester_id);
            if ($approvers === []) {
                $step->update(['status' => ApprovalRequestStep::STATUS_SKIPPED, 'completed_at' => now()]);
                self::log($request, null, 'skipped', $step, null, ['reason' => 'no_approvers']);

                continue;
            }

            $step->update(['status' => ApprovalRequestStep::STATUS_PENDING, 'activated_at' => now()]);
            foreach ($approvers as $a) {
                ApprovalStepApprover::create([
                    'organization_id' => $request->organization_id,
                    'approval_request_id' => $request->id,
                    'approval_request_step_id' => $step->id,
                    ...$a,
                ]);
            }
            self::log($request, null, 'step_started', $step, null, [
                'approvers' => array_column($approvers, 'user_id'),
                'delegations' => array_values(array_filter(array_map(fn ($a) => $a['delegated_from'] ? ['from' => $a['delegated_from'], 'to' => $a['user_id']] : null, $approvers))),
            ]);

            Notifier::send(
                $request->organization_id,
                array_column($approvers, 'user_id'),
                'approval.requested',
                'Approval needed: '.$request->title,
                $step->name.' · requested by '.($request->requester?->name ?? 'a member'),
                self::link($request),
                $request->requester_id,
                'approval-step:'.$step->id,
                ['approval_request_id' => $request->id],
                email: true,
            );

            return;
        }

        self::finish($request, ApprovalRequest::STATUS_APPROVED, $actor);
    }

    private static function stepIsApproved(ApprovalRequestStep $step): bool
    {
        $rows = $step->assignees()->get(['decision']);
        if ($step->mode === ApprovalWorkflowStep::MODE_ALL) {
            return $rows->every(fn ($r) => $r->decision === 'approved');
        }

        return $rows->contains(fn ($r) => $r->decision === 'approved');
    }

    private static function finish(ApprovalRequest $request, string $status, ?User $actor, ?string $comment = null): void
    {
        ApprovalRequestStep::where('approval_request_id', $request->id)
            ->where('round', $request->round)
            ->whereIn('status', [ApprovalRequestStep::STATUS_WAITING, ApprovalRequestStep::STATUS_PENDING])
            ->update(['status' => ApprovalRequestStep::STATUS_CANCELLED, 'completed_at' => now()]);

        $request->update([
            'status' => $status,
            'completed_at' => $status === ApprovalRequest::STATUS_RETURNED ? null : now(),
        ]);

        // The approver's own decision (with comment) is already logged by decide().
        if ($status === ApprovalRequest::STATUS_CANCELLED) {
            self::log($request, $actor, 'cancelled', null, $comment);
        } else {
            self::log($request, null, 'completed', null, null, ['status' => $status]);
        }

        if ($status !== ApprovalRequest::STATUS_CANCELLED) {
            $labels = [
                ApprovalRequest::STATUS_APPROVED => 'Approved',
                ApprovalRequest::STATUS_REJECTED => 'Rejected',
                ApprovalRequest::STATUS_RETURNED => 'Returned for changes',
            ];
            Notifier::send(
                $request->organization_id, [$request->requester_id], 'approval.'.$status,
                $labels[$status].': '.$request->title,
                $comment, self::link($request), $actor?->id,
                'approval-result:'.$request->id.':'.$request->round.':'.$status,
                ['approval_request_id' => $request->id], email: true,
            );
        }

        self::dispatchStatus($request);
    }

    private static function remind(ApprovalRequestStep $step): void
    {
        $request = $step->request;
        $waiting = $step->assignees()->whereNull('decision')->pluck('user_id');
        self::log($request, null, 'reminded', $step, null, ['approvers' => $waiting->all()]);
        Notifier::send(
            $request->organization_id, $waiting, 'approval.reminder',
            'Reminder: '.$request->title.' is waiting for you',
            $step->name.' passed its '.$step->sla_hours.'-hour target.',
            self::link($request), null, 'approval-reminder:'.$step->id,
            ['approval_request_id' => $request->id], email: true,
        );
    }

    private static function escalate(ApprovalRequestStep $step): void
    {
        $request = $step->request;
        $userId = (int) $step->escalate_to;
        if ($userId === $request->requester_id || self::activeMemberIds($request->organization_id, [$userId]) === []) {
            return;
        }

        ApprovalStepApprover::firstOrCreate(
            ['approval_request_step_id' => $step->id, 'user_id' => $userId],
            ['organization_id' => $request->organization_id, 'approval_request_id' => $request->id, 'source' => 'escalation'],
        );
        self::log($request, null, 'escalated', $step, null, ['to' => $userId]);
        Notifier::send(
            $request->organization_id, [$userId], 'approval.escalated',
            'Escalated to you: '.$request->title,
            $step->name.' is overdue. You can now approve it.',
            self::link($request), null, 'approval-escalation:'.$step->id,
            ['approval_request_id' => $request->id], email: true,
        );
    }

    private static function log(ApprovalRequest $request, ?User $actor, string $action, ?ApprovalRequestStep $step = null, ?string $comment = null, array $properties = []): void
    {
        ApprovalAction::create([
            'organization_id' => $request->organization_id,
            'approval_request_id' => $request->id,
            'approval_request_step_id' => $step?->id,
            'actor_id' => $actor?->id,
            'action' => $action,
            'comment' => $comment,
            'properties' => ['round' => $request->round, ...$properties],
        ]);
    }

    private static function dispatchStatus(ApprovalRequest $request): void
    {
        ApprovalRequestStatusChanged::dispatch($request->id, $request->status, $request->entity_type, $request->entity_id);
    }

    private static function link(ApprovalRequest $request): string
    {
        return '/apps/approval/requests/'.$request->id;
    }

    private static function pastTense(string $decision): string
    {
        return match ($decision) {
            'approve' => 'approved',
            'reject' => 'rejected',
            'return' => 'returned',
        };
    }

    /** @return list<int> */
    private static function activeMemberIds(int $organizationId, array $ids): array
    {
        if ($ids === []) {
            return [];
        }

        return OrganizationMembership::where('organization_id', $organizationId)
            ->where('status', OrganizationMembership::STATUS_ACTIVE)
            ->whereIn('user_id', $ids)->pluck('user_id')->map(fn ($id) => (int) $id)->all();
    }
}
