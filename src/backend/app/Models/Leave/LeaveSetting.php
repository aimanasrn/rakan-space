<?php

namespace App\Models\Leave;

use App\Models\Approval\ApprovalWorkflow;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class LeaveSetting extends Model
{
    protected $fillable = ['organization_id', 'workflow_id'];

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(ApprovalWorkflow::class, 'workflow_id');
    }
}
