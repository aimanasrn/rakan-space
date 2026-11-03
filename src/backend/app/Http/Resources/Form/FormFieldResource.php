<?php

namespace App\Http\Resources\Form;

use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class FormFieldResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'key' => $this->key,
            'type' => $this->type,
            'label' => $this->label,
            'help_text' => $this->help_text,
            'required' => $this->required,
            'options' => $this->options,
            'validation' => $this->validation,
            'visibility' => $this->visibility,
        ];
    }
}
