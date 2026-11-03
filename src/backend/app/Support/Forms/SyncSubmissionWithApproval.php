<?php

namespace App\Support\Forms;

use App\Events\ApprovalRequestStatusChanged;
use App\Models\Form\FormSubmission;

/** Keeps a form submission's status in step with its approval request. */
class SyncSubmissionWithApproval
{
    public function handle(ApprovalRequestStatusChanged $event): void
    {
        if ($event->entityType !== Forms::ENTITY || ! $event->entityId) {
            return;
        }

        FormSubmission::whereKey($event->entityId)
            ->where(fn ($q) => $q->where('approval_request_id', $event->approvalRequestId)->orWhereNull('approval_request_id'))
            ->update(['status' => Forms::statusFor($event->status)]);
    }
}
