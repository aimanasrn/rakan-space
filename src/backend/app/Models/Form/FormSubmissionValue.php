<?php

namespace App\Models\Form;

use Illuminate\Database\Eloquent\Model;

class FormSubmissionValue extends Model
{
    protected $fillable = ['organization_id', 'form_submission_id', 'field_key', 'value'];

    protected function casts(): array
    {
        return ['value' => 'json'];
    }
}
