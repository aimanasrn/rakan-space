<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class ActivityResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'event' => $this->event,
            'actor' => $this->whenLoaded('actor', fn () => $this->actor ? new UserSummaryResource($this->actor) : null),
            'subject_type' => $this->subject_type,
            'subject_id' => $this->subject_id,
            'project_id' => $this->project_id,
            'properties' => $this->properties ?? (object) [],
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
