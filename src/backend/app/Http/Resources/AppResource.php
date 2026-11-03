<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** Catalogue fields of a launcher app. Controllers add per-user context. */
class AppResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'key' => $this->key,
            'name' => $this->name,
            'tagline' => $this->tagline,
            'description' => $this->description,
            'icon' => $this->icon,
            'gradient' => [$this->gradient_from, $this->gradient_to],
            'category' => $this->category,
            'path' => $this->path(),
        ];
    }
}
