<?php

namespace App\Models\Timesheet;

use App\Models\Approval\ApprovalRequest;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Timesheet extends Model
{
    public const STATUS_DRAFT = 'draft';

    public const STATUS_PENDING_APPROVAL = 'pending_approval';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_RETURNED = 'returned';

    public const STATUSES = ['draft', 'pending_approval', 'approved', 'rejected', 'returned'];

    /** The owner can change entries in these states. */
    public const EDITABLE = ['draft', 'returned', 'rejected'];

    protected $fillable = ['organization_id', 'user_id', 'week_start', 'status', 'total_minutes', 'approval_request_id', 'submitted_at'];

    protected $attributes = ['status' => 'draft', 'total_minutes' => 0];

    protected function casts(): array
    {
        return ['week_start' => 'date', 'submitted_at' => 'datetime', 'total_minutes' => 'integer'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function entries(): HasMany
    {
        return $this->hasMany(TimesheetEntry::class)->orderBy('work_date')->orderBy('id');
    }

    public function approvalRequest(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    public function isEditable(): bool
    {
        return in_array($this->status, self::EDITABLE, true);
    }

    /** Workspace-relative link to the sheet. */
    public function link(): string
    {
        return '/apps/timesheet/sheets/'.$this->id;
    }
}
