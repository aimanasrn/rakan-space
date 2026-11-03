<?php

namespace Tests\Unit;

use App\Support\Conditions;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

class ConditionsTest extends TestCase
{
    public static function cases(): array
    {
        $data = ['amount' => 7500, 'type' => 'Laptop', 'tags' => ['urgent', 'it'], 'note' => '', 'date' => '2026-12-01', 'text_amount' => '120'];

        return [
            'no condition' => [null, $data, true],
            'gt number' => [['field' => 'amount', 'operator' => 'gt', 'value' => 5000], $data, true],
            'gt boundary' => [['field' => 'amount', 'operator' => 'gt', 'value' => 7500], $data, false],
            'gte boundary' => [['field' => 'amount', 'operator' => 'gte', 'value' => '7500'], $data, true],
            'lt numeric strings' => [['field' => 'text_amount', 'operator' => 'lt', 'value' => '99'], $data, false],
            'eq case-insensitive' => [['field' => 'type', 'operator' => 'eq', 'value' => 'laptop'], $data, true],
            'neq' => [['field' => 'type', 'operator' => 'neq', 'value' => 'Monitor'], $data, true],
            'eq on checkbox list' => [['field' => 'tags', 'operator' => 'eq', 'value' => 'urgent'], $data, true],
            'contains in list' => [['field' => 'tags', 'operator' => 'contains', 'value' => 'finance'], $data, false],
            'contains text' => [['field' => 'type', 'operator' => 'contains', 'value' => 'lap'], $data, true],
            'date compare' => [['field' => 'date', 'operator' => 'lt', 'value' => '2027-01-01'], $data, true],
            'empty string is empty' => [['field' => 'note', 'operator' => 'empty'], $data, true],
            'missing is empty' => [['field' => 'nope', 'operator' => 'filled'], $data, false],
            'missing never greater' => [['field' => 'nope', 'operator' => 'gt', 'value' => 0], $data, false],
            'unknown operator' => [['field' => 'amount', 'operator' => 'regex', 'value' => '.*'], $data, false],
        ];
    }

    #[DataProvider('cases')]
    public function test_conditions(?array $condition, array $data, bool $expected): void
    {
        $this->assertSame($expected, Conditions::matches($condition, $data));
    }
}
