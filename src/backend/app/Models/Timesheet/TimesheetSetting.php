<?php

namespace App\Models\Timesheet;

use App\Models\Approval\ApprovalWorkflow;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TimesheetSetting extends Model
{
    protected $fillable = ['organization_id', 'workflow_id'];

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(ApprovalWorkflow::class, 'workflow_id');
    }
}
