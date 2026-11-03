<?php

namespace App\Http\Resources;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class AttachmentResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $base = '/api/orgs/'.$request->route('organization')?->slug.'/attachments/'.$this->id;
        $previewable = in_array($this->mime_type, config('rakanspace.attachments.inline_mime_types'), true);

        return [
            'id' => $this->id,
            'name' => $this->original_name,
            'extension' => $this->extension,
            'mime_type' => $this->mime_type,
            'size' => $this->size,
            'is_image' => str_starts_with($this->mime_type, 'image/'),
            'previewable' => $previewable,
            'download_url' => url($base.'/download'),
            'preview_url' => $previewable ? url($base.'/download?inline=1') : null,
            'uploader' => $this->whenLoaded('uploader', fn () => $this->uploader ? new UserSummaryResource($this->uploader) : null),
            'source' => $this->attachable_type,
            'source_id' => $this->attachable_id,
            'created_at' => $this->created_at->toIso8601String(),
        ];
    }
}
