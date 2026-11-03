<?php

namespace App\Http\Resources;

use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class TaskResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $withPermissions = $this->relationLoaded('project') && $user;

        return [
            'id' => $this->id,
            'project_id' => $this->project_id,
            'project' => $this->whenLoaded('project', fn () => ['id' => $this->project->id, 'name' => $this->project->name]),
            'title' => $this->title,
            'description' => $this->description,
            'status' => $this->status->value,
            'priority' => $this->priority->value,
            'due_date' => $this->due_date?->format('Y-m-d'),
            'position' => $this->position,
            'completed_at' => $this->completed_at?->toIso8601String(),
            'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee ? new UserSummaryResource($this->assignee) : null),
            'creator' => $this->whenLoaded('creator', fn () => $this->creator ? new UserSummaryResource($this->creator) : null),
            'checklist' => $this->whenLoaded('checklistItems', fn () => $this->checklistItems->map(fn ($i) => [
                'id' => $i->id, 'body' => $i->body, 'is_done' => $i->is_done, 'position' => $i->position,
            ])),
            'checklist_total' => $this->whenCounted('checklistItems'),
            'checklist_done' => $this->when(isset($this->checklist_done_count), fn () => (int) $this->checklist_done_count),
            'comments_count' => $this->whenCounted('comments'),
            'attachments' => AttachmentResource::collection($this->whenLoaded('attachments')),
            'permissions' => $this->when($withPermissions, fn () => [
                'update' => Permissions::canUpdateTask($user, $this->resource),
                'delete' => Permissions::canDeleteTask($user, $this->resource),
            ]),
            'created_at' => $this->created_at->toIso8601String(),
            'updated_at' => $this->updated_at->toIso8601String(),
        ];
    }
}
