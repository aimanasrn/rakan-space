<?php

namespace App\Support\Forms;

use App\Models\Form\FormField;
use App\Support\Conditions;
use Illuminate\Support\Facades\Validator;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/**
 * Validates and normalises field definitions coming from the form builder.
 */
class FormSchema
{
    public const MAX_FIELDS = 100;

    /**
     * @param  array<int, array<string, mixed>>  $fields
     * @return list<array<string, mixed>> Normalised fields, in order, with unique keys.
     */
    public static function normalize(array $fields): array
    {
        $validator = Validator::make(['fields' => $fields], [
            'fields' => ['present', 'array', 'max:'.self::MAX_FIELDS],
            'fields.*' => ['array'],
            'fields.*.key' => ['nullable', 'string', 'regex:/^[a-z][a-z0-9_]{0,59}$/'],
            'fields.*.type' => ['required', Rule::in(FormField::TYPES)],
            'fields.*.label' => ['required', 'string', 'max:200'],
            'fields.*.help_text' => ['nullable', 'string', 'max:500'],
            'fields.*.required' => ['sometimes', 'boolean'],
            'fields.*.options' => ['nullable', 'array'],
            'fields.*.options.choices' => ['nullable', 'array', 'max:200'],
            // Blank choices arrive as null (ConvertEmptyStringsToNull) and are dropped below.
            'fields.*.options.choices.*' => ['nullable', 'string', 'max:200'],
            'fields.*.options.columns' => ['nullable', 'array', 'max:20'],
            'fields.*.options.columns.*.key' => ['nullable', 'string', 'regex:/^[a-z][a-z0-9_]{0,59}$/'],
            'fields.*.options.columns.*.label' => ['required_with:fields.*.options.columns', 'string', 'max:120'],
            'fields.*.options.columns.*.type' => ['required_with:fields.*.options.columns', Rule::in(FormField::TABLE_COLUMN_TYPES)],
            'fields.*.options.columns.*.choices' => ['nullable', 'array', 'max:100'],
            'fields.*.options.columns.*.choices.*' => ['nullable', 'string', 'max:200'],
            'fields.*.validation' => ['nullable', 'array'],
            'fields.*.validation.min' => ['nullable', 'numeric'],
            'fields.*.validation.max' => ['nullable', 'numeric'],
            'fields.*.validation.min_length' => ['nullable', 'integer', 'min:0', 'max:10000'],
            'fields.*.validation.max_length' => ['nullable', 'integer', 'min:1', 'max:10000'],
            'fields.*.validation.max_files' => ['nullable', 'integer', 'min:1', 'max:10'],
            'fields.*.validation.max_rows' => ['nullable', 'integer', 'min:1', 'max:100'],
            ...Conditions::rules('fields.*.visibility'),
        ], [], ['fields.*.label' => 'label']);
        $validator->validate();

        $errors = [];
        $keys = [];
        $result = [];
        foreach (array_values($fields) as $i => $field) {
            $type = $field['type'];
            $key = $field['key'] ?? null ?: self::keyFromLabel($field['label']);
            $key = self::unique($key, $keys);
            $keys[] = $key;

            $options = null;
            if (in_array($type, FormField::CHOICE_TYPES, true)) {
                $choices = self::cleanChoices($field['options']['choices'] ?? []);
                if ($choices === []) {
                    $errors["fields.$i.options.choices"] = "Add at least one choice for \"{$field['label']}\".";
                }
                $options = ['choices' => $choices];
            } elseif ($type === 'table') {
                $columns = [];
                $columnKeys = [];
                foreach ($field['options']['columns'] ?? [] as $column) {
                    $columnKey = self::unique($column['key'] ?? null ?: self::keyFromLabel($column['label']), $columnKeys);
                    $columnKeys[] = $columnKey;
                    $col = ['key' => $columnKey, 'label' => $column['label'], 'type' => $column['type']];
                    if ($column['type'] === 'dropdown') {
                        $col['choices'] = self::cleanChoices($column['choices'] ?? []);
                        if ($col['choices'] === []) {
                            $errors["fields.$i.options.columns"] = "Add choices to the \"{$column['label']}\" column.";
                        }
                    }
                    $columns[] = $col;
                }
                if ($columns === []) {
                    $errors["fields.$i.options.columns"] = "Add at least one column to \"{$field['label']}\".";
                }
                $options = ['columns' => $columns];
            }

            $validation = array_filter(
                array_intersect_key($field['validation'] ?? [], array_flip(['min', 'max', 'min_length', 'max_length', 'max_files', 'max_rows'])),
                fn ($v) => $v !== null && $v !== '',
            );
            if (isset($validation['min'], $validation['max']) && (float) $validation['min'] > (float) $validation['max']) {
                $errors["fields.$i.validation.max"] = 'The maximum must be at least the minimum.';
            }

            // Conditions may only refer to an earlier field, which also rules out loops.
            $visibility = null;
            if (! empty($field['visibility']['field'])) {
                $source = $field['visibility']['field'];
                if (! in_array($source, array_slice($keys, 0, -1), true)) {
                    $errors["fields.$i.visibility.field"] = "\"{$field['label']}\" can only depend on a field above it.";
                }
                $visibility = [
                    'field' => $source,
                    'operator' => $field['visibility']['operator'],
                    'value' => $field['visibility']['value'] ?? null,
                ];
            }

            $result[] = [
                'key' => $key,
                'type' => $type,
                'label' => $field['label'],
                'help_text' => $field['help_text'] ?? null,
                'required' => (bool) ($field['required'] ?? false),
                'position' => $i + 1,
                'options' => $options,
                'validation' => $validation ?: null,
                'visibility' => $visibility,
            ];
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $result;
    }

    public static function keyFromLabel(string $label): string
    {
        $key = Str::of($label)->ascii()->lower()->replaceMatches('/[^a-z0-9]+/', '_')->trim('_')->limit(50, '')->toString();
        if ($key === '' || ! preg_match('/^[a-z]/', $key)) {
            $key = 'field_'.$key;
        }

        return rtrim($key, '_');
    }

    private static function unique(string $key, array $taken): string
    {
        $candidate = $key;
        $n = 2;
        while (in_array($candidate, $taken, true)) {
            $candidate = mb_substr($key, 0, 55).'_'.$n++;
        }

        return $candidate;
    }

    /** @return list<string> */
    private static function cleanChoices(array $choices): array
    {
        return array_values(array_unique(array_filter(array_map(fn ($c) => trim((string) $c), $choices), fn ($c) => $c !== '')));
    }
}
