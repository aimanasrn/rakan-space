<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class MessageResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $deleted = $this->deleted_at !== null;

        return [
            'id' => $this->id,
            'conversation_id' => $this->conversation_id,
            'client_id' => $this->client_id,
            'user' => $this->whenLoaded('user', fn () => $this->user ? new UserSummaryResource($this->user) : null),
            'user_id' => $this->user_id,
            'body' => $deleted ? null : $this->body,
            'mentions' => $deleted ? [] : ($this->mentions ?? []),
            'parent' => $this->whenLoaded('parent', fn () => $this->parent ? [
                'id' => $this->parent->id,
                'user_name' => $this->parent->user?->name,
                'excerpt' => $this->parent->deleted_at ? null : mb_strimwidth((string) $this->parent->body, 0, 140, '…'),
                'deleted' => $this->parent->deleted_at !== null,
            ] : null),
            'attachments' => $deleted ? [] : AttachmentResource::collection($this->whenLoaded('attachments')),
            'edited' => $this->edited_at !== null,
            'deleted' => $deleted,
            'created_at' => $this->created_at->toIso8601String(),
            'edited_at' => $this->edited_at?->toIso8601String(),
        ];
    }
}
