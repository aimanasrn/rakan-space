<?php

namespace App\Http\Resources\Form;

use App\Http\Resources\UserSummaryResource;
use App\Support\Permissions;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FormResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $manage = Permissions::canManageForm($user, $this->resource);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'description' => $this->description,
            'status' => $this->status,
            'audience' => [
                'roles' => $this->audience['roles'] ?? [],
                'department_ids' => array_map('intval', $this->audience['department_ids'] ?? []),
            ],
            'workflow' => $this->whenLoaded('workflow', fn () => $this->workflow ? ['id' => $this->workflow->id, 'name' => $this->workflow->name] : null),
            'allow_multiple' => $this->allow_multiple,
            'version' => $this->whenLoaded('currentVersion', fn () => $this->currentVersion?->version),
            'has_unpublished_changes' => $this->when($manage && $this->relationLoaded('draftVersion'), fn () => $this->draftVersion !== null),
            'submissions_count' => $this->when($manage && isset($this->submissions_count), fn () => (int) $this->submissions_count),
            'my_submissions_count' => $this->when(isset($this->my_submissions_count), fn () => (int) $this->my_submissions_count),
            'created_by' => $this->whenLoaded('creator', fn () => $this->creator ? new UserSummaryResource($this->creator) : null),
            'published_at' => $this->published_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'permissions' => [
                'manage' => $manage,
                'delete' => Permissions::canDeleteForm($user, $this->resource),
                'fill' => Permissions::canFillForm($user, $this->resource),
            ],
        ];
    }
}
