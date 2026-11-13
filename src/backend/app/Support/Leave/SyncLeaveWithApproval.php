<?php

namespace App\Support\Leave;

use App\Events\ApprovalRequestStatusChanged;
use App\Models\Approval\ApprovalRequest;
use App\Models\Leave\LeaveRequest;

/** Keeps a leave application's status in step with its approval request. */
class SyncLeaveWithApproval
{
    public function handle(ApprovalRequestStatusChanged $event): void
    {
        if ($event->entityType !== Leaves::ENTITY || ! $event->entityId) {
            return;
        }

        $changes = ['status' => Leaves::statusFor($event->status)];
        if ($event->status === ApprovalRequest::STATUS_CANCELLED) {
            $changes['cancelled_at'] = now();
        }

        LeaveRequest::whereKey($event->entityId)
            // A cancelled application stays cancelled.
            ->where('status', '!=', LeaveRequest::STATUS_CANCELLED)
            ->where(fn ($q) => $q->where('approval_request_id', $event->approvalRequestId)->orWhereNull('approval_request_id'))
            ->update($changes);
    }
}
