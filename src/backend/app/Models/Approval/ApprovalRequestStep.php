<?php

namespace App\Models\Approval;

use Carbon\CarbonInterface;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ApprovalRequestStep extends Model
{
    public const STATUS_WAITING = 'waiting';

    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_RETURNED = 'returned';

    public const STATUS_SKIPPED = 'skipped';

    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'organization_id', 'approval_request_id', 'round', 'position', 'name', 'mode', 'approvers', 'condition',
        'status', 'sla_hours', 'escalate_to', 'activated_at', 'completed_at', 'reminded_at', 'escalated_at',
    ];

    protected $attributes = ['status' => self::STATUS_WAITING];

    protected function casts(): array
    {
        return [
            'approvers' => 'array', 'condition' => 'array', 'round' => 'integer', 'position' => 'integer', 'sla_hours' => 'integer',
            'activated_at' => 'datetime', 'completed_at' => 'datetime', 'reminded_at' => 'datetime', 'escalated_at' => 'datetime',
        ];
    }

    public function request(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class, 'approval_request_id');
    }

    public function assignees(): HasMany
    {
        return $this->hasMany(ApprovalStepApprover::class)->orderBy('id');
    }

    /** When the step's SLA runs out, if it has one. */
    public function dueAt(): ?CarbonInterface
    {
        return $this->sla_hours && $this->activated_at ? $this->activated_at->copy()->addHours($this->sla_hours) : null;
    }
}
