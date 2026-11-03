<?php

namespace App\Models\Approval;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ApprovalStepApprover extends Model
{
    protected $fillable = [
        'organization_id', 'approval_request_id', 'approval_request_step_id', 'user_id', 'source',
        'delegated_from', 'decision', 'comment', 'decided_at',
    ];

    protected function casts(): array
    {
        return ['decided_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function delegator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'delegated_from');
    }

    public function step(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequestStep::class, 'approval_request_step_id');
    }
}
