<?php

namespace App\Support;

/**
 * Evaluates a single condition {field, operator, value} against a set of values.
 * Used by form show/hide rules and conditional approval steps. The frontend
 * mirrors this in src/lib/conditions.ts; keep both in step.
 */
class Conditions
{
    public const OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'filled', 'empty'];

    /** Validation rules for a condition array under the given prefix. */
    public static function rules(string $prefix): array
    {
        return [
            $prefix => ['nullable', 'array'],
            "{$prefix}.field" => ["required_with:{$prefix}", 'string', 'max:60'],
            "{$prefix}.operator" => ["required_with:{$prefix}", 'in:'.implode(',', self::OPERATORS)],
            "{$prefix}.value" => ['nullable'],
        ];
    }

    /** A missing condition always matches. */
    public static function matches(?array $condition, array $data): bool
    {
        if (! $condition || empty($condition['field']) || empty($condition['operator'])) {
            return true;
        }

        $actual = $data[$condition['field']] ?? null;
        $expected = $condition['value'] ?? null;

        return match ($condition['operator']) {
            'filled' => ! self::isEmpty($actual),
            'empty' => self::isEmpty($actual),
            'eq' => self::equals($actual, $expected),
            'neq' => ! self::equals($actual, $expected),
            'contains' => self::contains($actual, $expected),
            'gt', 'gte', 'lt', 'lte' => self::compare($actual, $expected, $condition['operator']),
            default => false,
        };
    }

    private static function isEmpty(mixed $value): bool
    {
        return $value === null || $value === '' || $value === [] || $value === false;
    }

    private static function equals(mixed $actual, mixed $expected): bool
    {
        if (is_array($actual)) {
            return in_array((string) $expected, array_map('strval', $actual), true);
        }
        if (is_numeric($actual) && is_numeric($expected)) {
            return (float) $actual === (float) $expected;
        }
        if (is_bool($actual)) {
            return $actual === filter_var($expected, FILTER_VALIDATE_BOOLEAN);
        }

        return mb_strtolower(trim((string) $actual)) === mb_strtolower(trim((string) $expected));
    }

    private static function contains(mixed $actual, mixed $expected): bool
    {
        if (is_array($actual)) {
            return in_array((string) $expected, array_map('strval', $actual), true);
        }

        return $expected !== null && $expected !== ''
            && str_contains(mb_strtolower((string) $actual), mb_strtolower((string) $expected));
    }

    /** Numbers compare numerically; anything else (e.g. YYYY-MM-DD dates) as strings. */
    private static function compare(mixed $actual, mixed $expected, string $op): bool
    {
        if (self::isEmpty($actual) || is_array($actual) || $expected === null || $expected === '') {
            return false;
        }

        $cmp = is_numeric($actual) && is_numeric($expected)
            ? ((float) $actual <=> (float) $expected)
            : strcmp((string) $actual, (string) $expected);

        return match ($op) {
            'gt' => $cmp > 0,
            'gte' => $cmp >= 0,
            'lt' => $cmp < 0,
            'lte' => $cmp <= 0,
        };
    }
}
