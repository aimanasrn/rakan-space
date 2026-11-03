<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class OrganizationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'slug' => $this->slug,
            'description' => $this->description,
            'timezone' => $this->timezone,
            'industry' => $this->industry,
            'website' => $this->website,
            'logo_url' => $this->logoUrl(),
            'onboarding_completed' => $this->onboarding_completed_at !== null,
            'created_at' => $this->created_at?->toIso8601String(),
        ];
    }
}
