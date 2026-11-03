<?php

namespace App\Events;

use Illuminate\Foundation\Events\Dispatchable;

/**
 * Fired (synchronously, inside the approval transaction) whenever a request
 * becomes approved, rejected, returned, cancelled or pending again after a
 * resubmit. Modules listen to update the item being approved. Carries IDs only.
 */
class ApprovalRequestStatusChanged
{
    use Dispatchable;

    public function __construct(
        public int $approvalRequestId,
        public string $status,
        public string $entityType,
        public ?int $entityId,
    ) {}
}
