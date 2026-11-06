<?php

namespace App\Http\Resources\Timesheet;

use App\Http\Resources\UserSummaryResource;
use App\Models\Timesheet\Timesheet;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Timesheet */
class TimesheetResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $mine = $this->user_id === $request->user()->id;

        return [
            'id' => $this->id,
            'week_start' => $this->week_start->toDateString(),
            'week_end' => $this->week_start->copy()->addDays(6)->toDateString(),
            'status' => $this->status,
            'total_minutes' => $this->total_minutes,
            'user' => $this->whenLoaded('user', fn () => new UserSummaryResource($this->user)),
            'approval_request_id' => $this->approval_request_id,
            'submitted_at' => $this->submitted_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'entries' => $this->whenLoaded('entries', fn () => $this->entries->map(fn ($e) => [
                'id' => $e->id,
                'project_id' => $e->project_id,
                'task_id' => $e->task_id,
                'project_name' => $e->project_name,
                'task_title' => $e->task_title,
                'work_date' => $e->work_date->toDateString(),
                'minutes' => $e->minutes,
                'note' => $e->note,
            ])->values()),
            'permissions' => [
                'edit' => $mine && $this->isEditable(),
                'submit' => $mine && in_array($this->status, [Timesheet::STATUS_DRAFT, Timesheet::STATUS_RETURNED], true) && $this->total_minutes > 0,
                'withdraw' => $mine && in_array($this->status, [Timesheet::STATUS_PENDING_APPROVAL, Timesheet::STATUS_RETURNED], true),
            ],
        ];
    }
}
