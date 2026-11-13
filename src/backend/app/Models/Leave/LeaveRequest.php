<?php

namespace App\Models\Leave;

use App\Models\Approval\ApprovalRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeaveRequest extends Model
{
    public const STATUS_PENDING_APPROVAL = 'pending_approval';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_RETURNED = 'returned';

    public const STATUS_CANCELLED = 'cancelled';

    public const STATUSES = ['pending_approval', 'approved', 'rejected', 'returned', 'cancelled'];

    /** Waiting for a decision: counted as "pending" against the balance and blocks overlapping dates. */
    public const OPEN = ['pending_approval', 'returned'];

    /** Holds the dates: no other application may overlap these. */
    public const HOLDS_DATES = ['pending_approval', 'returned', 'approved'];

    public const HALF_DAYS = ['none', 'am', 'pm'];

    protected $fillable = [
        'organization_id', 'user_id', 'leave_type_id', 'start_date', 'end_date', 'half_day', 'days', 'reason',
        'status', 'approval_request_id', 'submitted_at', 'cancelled_at',
    ];

    protected $attributes = ['status' => 'pending_approval', 'half_day' => 'none'];

    protected function casts(): array
    {
        return [
            'start_date' => 'date', 'end_date' => 'date', 'days' => 'float',
            'submitted_at' => 'datetime', 'cancelled_at' => 'datetime',
        ];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function type(): BelongsTo
    {
        return $this->belongsTo(LeaveType::class, 'leave_type_id');
    }

    public function approvalRequest(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    /** Workspace-relative link to the application. */
    public function link(): string
    {
        return '/apps/leave/requests/'.$this->id;
    }
}
