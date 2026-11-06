<?php

namespace App\Support\Timesheets;

use App\Events\ApprovalRequestStatusChanged;
use App\Models\Approval\ApprovalRequest;
use App\Models\Timesheet\Timesheet;

/** Keeps a timesheet's status in step with its approval request. */
class SyncTimesheetWithApproval
{
    public function handle(ApprovalRequestStatusChanged $event): void
    {
        if ($event->entityType !== Timesheets::ENTITY || ! $event->entityId) {
            return;
        }

        $changes = ['status' => Timesheets::statusFor($event->status)];
        if ($event->status === ApprovalRequest::STATUS_CANCELLED) {
            // Withdrawn: back to a draft; the next submit starts a new request.
            $changes['approval_request_id'] = null;
        }

        Timesheet::whereKey($event->entityId)
            ->where(fn ($q) => $q->where('approval_request_id', $event->approvalRequestId)->orWhereNull('approval_request_id'))
            ->update($changes);
    }
}
