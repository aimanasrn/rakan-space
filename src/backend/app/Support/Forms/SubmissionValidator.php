<?php

namespace App\Support\Forms;

use App\Models\Attachment;
use App\Models\Form\FormField;
use App\Models\Form\FormSubmission;
use App\Models\User;
use App\Support\Conditions;
use DateTime;
use Illuminate\Support\Collection;
use Illuminate\Validation\ValidationException;

/**
 * Server-side validation of a filled form. Hidden fields (by show/hide rules)
 * are dropped and never required. Errors are keyed "values.{field_key}".
 */
class SubmissionValidator
{
    /**
     * @param  Collection<int, FormField>  $fields  In display order.
     * @param  array<string, mixed>  $input  Values keyed by field key.
     * @param  FormSubmission|null  $existing  When resubmitting, files already on it stay valid.
     * @return array{values: array<string, mixed>, attachment_ids: list<int>}
     */
    public static function validate(Collection $fields, array $input, User $user, int $organizationId, ?FormSubmission $existing = null): array
    {
        $values = [];
        $errors = [];
        $attachmentIds = [];

        foreach ($fields as $field) {
            // Hidden fields' values are treated as empty for later conditions.
            if (! Conditions::matches($field->visibility, $values)) {
                continue;
            }

            $raw = $input[$field->key] ?? null;
            $error = null;
            $value = null;

            if (self::isEmpty($raw)) {
                if ($field->required) {
                    $error = "{$field->label} is required.";
                }
            } else {
                [$value, $error] = self::check($field, $raw);
            }

            if (! $error && in_array($field->type, ['file', 'signature'], true) && $value !== null) {
                $ids = (array) $value;
                $error = self::checkAttachments($ids, $user, $organizationId, $existing, $field->type === 'signature');
                if (! $error) {
                    array_push($attachmentIds, ...$ids);
                }
            }

            if ($error) {
                $errors['values.'.$field->key] = $error;
            } elseif ($value !== null) {
                $values[$field->key] = $value;
            }
        }

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return ['values' => $values, 'attachment_ids' => array_values(array_unique($attachmentIds))];
    }

    /**
     * Values usable in approval conditions and summaries (no files or tables).
     *
     * @return array<string, mixed>
     */
    public static function conditionData(Collection $fields, array $values): array
    {
        $data = [];
        foreach ($fields as $field) {
            if (array_key_exists($field->key, $values) && ! in_array($field->type, ['file', 'signature', 'table'], true)) {
                $data[$field->key] = $values[$field->key];
            }
        }

        return $data;
    }

    /** @return array{0: mixed, 1: string|null} */
    private static function check(FormField $field, mixed $raw): array
    {
        $rules = $field->validation ?? [];
        $label = $field->label;
        $choices = $field->options['choices'] ?? [];

        switch ($field->type) {
            case 'text':
            case 'textarea':
                if (! is_scalar($raw)) {
                    return [null, "{$label} must be text."];
                }
                $text = trim((string) $raw);
                $max = (int) ($rules['max_length'] ?? ($field->type === 'text' ? 255 : 5000));
                if (mb_strlen($text) > $max) {
                    return [null, "{$label} must be at most {$max} characters."];
                }
                if (isset($rules['min_length']) && mb_strlen($text) < (int) $rules['min_length']) {
                    return [null, "{$label} must be at least {$rules['min_length']} characters."];
                }

                return [$text, null];

            case 'number':
                if (! is_numeric($raw) || ! is_finite((float) $raw)) {
                    return [null, "{$label} must be a number."];
                }
                $number = $raw + 0;
                if (isset($rules['min']) && $number < (float) $rules['min']) {
                    return [null, "{$label} must be at least {$rules['min']}."];
                }
                if (isset($rules['max']) && $number > (float) $rules['max']) {
                    return [null, "{$label} must be at most {$rules['max']}."];
                }

                return [$number, null];

            case 'date':
                return self::isDate($raw) ? [$raw, null] : [null, "{$label} must be a valid date."];

            case 'dropdown':
            case 'radio':
                return is_string($raw) && in_array($raw, $choices, true) ? [$raw, null] : [null, "Choose a valid option for {$label}."];

            case 'checkbox':
                if (! is_array($raw) || array_filter($raw, fn ($v) => ! is_scalar($v)) || array_diff(array_map('strval', $raw), $choices) !== []) {
                    return [null, "Choose valid options for {$label}."];
                }

                return [array_values(array_intersect($choices, array_map('strval', $raw))), null];

            case 'file':
                $max = (int) ($rules['max_files'] ?? 5);
                if (! is_array($raw) || array_filter($raw, fn ($id) => ! is_int($id) && ! ctype_digit((string) $id))) {
                    return [null, "{$label} has invalid files."];
                }
                if (count($raw) > $max) {
                    return [null, "{$label} accepts at most {$max} files."];
                }

                return [array_values(array_unique(array_map('intval', $raw))), null];

            case 'signature':
                return is_int($raw) || ctype_digit((string) $raw) ? [(int) $raw, null] : [null, "{$label} needs a signature."];

            case 'table':
                return self::checkTable($field, $raw);
        }

        return [null, "{$label} is not supported."];
    }

    /** @return array{0: mixed, 1: string|null} */
    private static function checkTable(FormField $field, mixed $raw): array
    {
        $label = $field->label;
        $max = (int) ($field->validation['max_rows'] ?? 50);
        if (! is_array($raw) || ! array_is_list($raw)) {
            return [null, "{$label} has invalid rows."];
        }
        if (count($raw) > $max) {
            return [null, "{$label} accepts at most {$max} rows."];
        }

        $rows = [];
        foreach ($raw as $n => $row) {
            if (! is_array($row)) {
                return [null, 'Row '.($n + 1)." of {$label} is invalid."];
            }
            $clean = [];
            foreach ($field->options['columns'] ?? [] as $column) {
                $cell = $row[$column['key']] ?? null;
                if (self::isEmpty($cell)) {
                    continue;
                }
                $ok = match ($column['type']) {
                    'text' => is_scalar($cell) && mb_strlen((string) $cell) <= 500,
                    'number' => is_numeric($cell),
                    'date' => self::isDate($cell),
                    'dropdown' => is_string($cell) && in_array($cell, $column['choices'] ?? [], true),
                    default => false,
                };
                if (! $ok) {
                    return [null, 'Row '.($n + 1).", {$column['label']}: invalid value."];
                }
                $clean[$column['key']] = $column['type'] === 'number' ? $cell + 0 : (is_string($cell) ? trim($cell) : $cell);
            }
            if ($clean !== []) {
                $rows[] = $clean;
            }
        }

        if ($rows === [] && $field->required) {
            return [null, "Add at least one row to {$label}."];
        }

        return [$rows ?: null, null];
    }

    /** Only the user's own unattached uploads, or files already on the submission being edited. */
    private static function checkAttachments(array $ids, User $user, int $organizationId, ?FormSubmission $existing, bool $imageOnly): ?string
    {
        $found = Attachment::query()
            ->whereIn('id', $ids)
            ->where('organization_id', $organizationId)
            ->where(function ($q) use ($user, $existing) {
                $q->where(fn ($p) => $p->where('uploader_id', $user->id)->whereNull('attachable_type'));
                if ($existing) {
                    $q->orWhere(fn ($e) => $e->where('attachable_type', 'form_submission')->where('attachable_id', $existing->id));
                }
            })
            ->get(['id', 'mime_type']);

        if ($found->count() !== count($ids)) {
            return 'One or more files are invalid or already used.';
        }
        if ($imageOnly && $found->contains(fn ($a) => ! in_array($a->mime_type, ['image/png', 'image/jpeg', 'image/webp'], true))) {
            return 'The signature must be an image.';
        }

        return null;
    }

    private static function isDate(mixed $value): bool
    {
        if (! is_string($value) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            return false;
        }
        $date = DateTime::createFromFormat('!Y-m-d', $value);

        return $date !== false && $date->format('Y-m-d') === $value;
    }

    private static function isEmpty(mixed $value): bool
    {
        return $value === null || $value === '' || $value === [] || (is_string($value) && trim($value) === '');
    }
}
