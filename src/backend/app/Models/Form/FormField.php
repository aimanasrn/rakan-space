<?php

namespace App\Models\Form;

use Illuminate\Database\Eloquent\Model;

class FormField extends Model
{
    public const TYPES = ['text', 'textarea', 'number', 'date', 'dropdown', 'radio', 'checkbox', 'file', 'signature', 'table'];

    /** Types whose value comes from a fixed list of choices. */
    public const CHOICE_TYPES = ['dropdown', 'radio', 'checkbox'];

    /** Column types allowed inside a table (repeater) field. */
    public const TABLE_COLUMN_TYPES = ['text', 'number', 'date', 'dropdown'];

    protected $fillable = [
        'organization_id', 'form_version_id', 'key', 'type', 'label', 'help_text', 'required', 'position',
        'options', 'validation', 'visibility',
    ];

    protected function casts(): array
    {
        return ['required' => 'boolean', 'position' => 'integer', 'options' => 'array', 'validation' => 'array', 'visibility' => 'array'];
    }
}
