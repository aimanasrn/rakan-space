<?php

namespace App\Models\Timesheet;

use App\Models\Project;
use App\Models\Task;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class TimesheetEntry extends Model
{
    protected $fillable = ['organization_id', 'timesheet_id', 'project_id', 'task_id', 'project_name', 'task_title', 'work_date', 'minutes', 'note'];

    protected function casts(): array
    {
        return ['work_date' => 'date', 'minutes' => 'integer'];
    }

    public function timesheet(): BelongsTo
    {
        return $this->belongsTo(Timesheet::class);
    }

    public function project(): BelongsTo
    {
        return $this->belongsTo(Project::class);
    }

    public function task(): BelongsTo
    {
        return $this->belongsTo(Task::class);
    }
}
