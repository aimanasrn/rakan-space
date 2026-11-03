<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class LauncherBannerResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $organization = $request->route('organization');

        return [
            'id' => $this->id,
            'title' => $this->title,
            'description' => $this->description,
            'cta_label' => $this->cta_label,
            'cta_url' => $this->cta_url,
            'image_url' => $this->imageUrl($organization->slug),
            'illustration' => $this->illustration,
            'is_active' => $this->is_active,
            'is_live' => $this->isLive(),
            'sort_order' => $this->sort_order,
            'starts_at' => $this->starts_at?->toIso8601String(),
            'ends_at' => $this->ends_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }
}
