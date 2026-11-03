<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AppAccessRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'status' => $this->status,
            'note' => $this->note,
            'app' => $this->whenLoaded('app', fn () => new AppResource($this->app)),
            'user' => $this->whenLoaded('user', fn () => new UserSummaryResource($this->user)),
            'decided_by' => $this->whenLoaded('decider', fn () => $this->decider ? new UserSummaryResource($this->decider) : null),
            'decided_at' => $this->decided_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
