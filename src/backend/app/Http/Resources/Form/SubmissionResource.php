<?php

namespace App\Http\Resources\Form;

use App\Http\Resources\AttachmentResource;
use App\Http\Resources\UserSummaryResource;
use App\Models\Form\FormSubmission;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class SubmissionResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $user = $request->user();
        $mine = $this->submitter_id === $user->id;

        return [
            'id' => $this->id,
            'reference' => $this->reference(),
            'status' => $this->status,
            'form' => $this->whenLoaded('form', fn () => ['id' => $this->form->id, 'name' => $this->form->name]),
            'version' => $this->whenLoaded('version', fn () => $this->version->version),
            'submitter' => $this->whenLoaded('submitter', fn () => new UserSummaryResource($this->submitter)),
            'approval_request_id' => $this->approval_request_id,
            'submitted_at' => $this->submitted_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
            'fields' => $this->when($this->relationLoaded('version') && $this->version->relationLoaded('fields'),
                fn () => FormFieldResource::collection($this->version->fields)),
            'values' => $this->whenLoaded('values', fn () => (object) $this->values->pluck('value', 'field_key')->all()),
            'attachments' => $this->whenLoaded('attachments', fn () => AttachmentResource::collection($this->attachments)),
            'permissions' => [
                'resubmit' => $mine && $this->status === FormSubmission::STATUS_RETURNED,
                'withdraw' => $mine && in_array($this->status, [FormSubmission::STATUS_SUBMITTED, FormSubmission::STATUS_PENDING_APPROVAL, FormSubmission::STATUS_RETURNED], true),
            ],
        ];
    }
}
