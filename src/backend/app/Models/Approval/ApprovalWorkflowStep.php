<?php

namespace App\Models\Approval;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class ApprovalWorkflowStep extends Model
{
    public const MODE_ANY = 'any';

    public const MODE_ALL = 'all';

    protected $fillable = ['organization_id', 'workflow_id', 'position', 'name', 'mode', 'approvers', 'condition', 'sla_hours', 'escalate_to'];

    protected function casts(): array
    {
        return ['approvers' => 'array', 'condition' => 'array', 'position' => 'integer', 'sla_hours' => 'integer'];
    }

    public function escalationUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'escalate_to');
    }
}
