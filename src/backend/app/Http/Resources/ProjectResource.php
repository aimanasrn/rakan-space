<?php

namespace App\Http\Resources;

use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ProjectResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $total = (int) ($this->tasks_count ?? 0);
        $done = (int) ($this->done_tasks_count ?? 0);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'status' => $this->status->value,
            'visibility' => $this->visibility,
            'start_date' => $this->start_date?->format('Y-m-d'),
            'target_date' => $this->target_date?->format('Y-m-d'),
            'archived' => $this->archived_at !== null,
            'archived_at' => $this->archived_at?->toIso8601String(),
            'manager' => $this->whenLoaded('manager', fn () => $this->manager ? new UserSummaryResource($this->manager) : null),
            'members' => $this->whenLoaded('memberships', fn () => $this->memberships->map(fn ($m) => [
                'role' => $m->role,
                'user' => new UserSummaryResource($m->user),
            ])),
            'members_count' => $this->whenCounted('memberships'),
            // Progress = completed tasks / all tasks in the project.
            'progress' => $this->when(isset($this->tasks_count), fn () => [
                'total' => $total,
                'done' => $done,
                'open' => (int) ($this->open_tasks_count ?? $total - $done),
                'overdue' => (int) ($this->overdue_tasks_count ?? 0),
                'percent' => $total > 0 ? (int) round($done * 100 / $total) : 0,
            ]),
            'permissions' => $this->when($user !== null, fn () => [
                'manage' => Permissions::canManageProject($user, $this->resource),
                'contribute' => Permissions::canContributeToProject($user, $this->resource),
            ]),
            'created_at' => $this->created_at->toIso8601String(),
            'updated_at' => $this->updated_at->toIso8601String(),
        ];
    }
}
