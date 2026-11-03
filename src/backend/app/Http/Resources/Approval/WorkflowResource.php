<?php

namespace App\Http\Resources\Approval;

use App\Http\Resources\UserSummaryResource;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class WorkflowResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'is_active' => $this->is_active,
            'steps_count' => $this->whenCounted('steps'),
            'requests_count' => $this->when(isset($this->requests_count), fn () => (int) $this->requests_count),
            'steps' => $this->whenLoaded('steps', fn () => $this->presentSteps()),
            'created_by' => $this->whenLoaded('creator', fn () => $this->creator ? new UserSummaryResource($this->creator) : null),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    private function presentSteps(): array
    {
        $ids = $this->steps->flatMap(fn ($s) => [
            ...collect($s->approvers)->where('type', 'user')->pluck('user_id'),
            $s->escalate_to,
        ])->filter()->unique()->all();
        $users = User::whereIn('id', $ids)->get()->keyBy('id');
        $summary = fn ($id) => $id && $users->has($id) ? (new UserSummaryResource($users[$id]))->resolve() : null;

        return $this->steps->map(fn ($s) => [
            'id' => $s->id,
            'position' => $s->position,
            'name' => $s->name,
            'mode' => $s->mode,
            'approvers' => collect($s->approvers)->map(fn ($a) => match ($a['type']) {
                'user' => ['type' => 'user', 'user_id' => $a['user_id'], 'user' => $summary($a['user_id'])],
                'role' => ['type' => 'role', 'role' => $a['role']],
                default => ['type' => $a['type']],
            })->values(),
            'condition' => $s->condition,
            'sla_hours' => $s->sla_hours,
            'escalate_to' => $summary($s->escalate_to),
        ])->values()->all();
    }
}
