<?php

namespace App\Models\Approval;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class ApprovalRequest extends Model
{
    public const STATUS_PENDING = 'pending';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_RETURNED = 'returned';

    public const STATUS_CANCELLED = 'cancelled';

    protected $fillable = [
        'organization_id', 'workflow_id', 'requester_id', 'entity_type', 'entity_id', 'title', 'summary',
        'data', 'link', 'status', 'round', 'submitted_at', 'completed_at',
    ];

    protected $attributes = ['status' => self::STATUS_PENDING, 'round' => 1];

    protected function casts(): array
    {
        return ['data' => 'array', 'round' => 'integer', 'submitted_at' => 'datetime', 'completed_at' => 'datetime'];
    }

    public function isOpen(): bool
    {
        return $this->status === self::STATUS_PENDING;
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(ApprovalWorkflow::class, 'workflow_id');
    }

    /** Steps of every round, oldest first. */
    public function allSteps(): HasMany
    {
        return $this->hasMany(ApprovalRequestStep::class)->orderBy('round')->orderBy('position');
    }

    public function approvers(): HasMany
    {
        return $this->hasMany(ApprovalStepApprover::class);
    }

    public function actions(): HasMany
    {
        return $this->hasMany(ApprovalAction::class)->orderBy('id');
    }
}
