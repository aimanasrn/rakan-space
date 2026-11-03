<?php

namespace App\Enums;

/**
 * What a member may do inside an installed app. Every ability implies "view".
 */
enum AppAbility: string
{
    case View = 'view';
    case Create = 'create';
    case Edit = 'edit';
    case Delete = 'delete';
    case Approve = 'approve';
    case Admin = 'admin';

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $a) => $a->value, self::cases());
    }

    /**
     * Normalises a list of ability names: unknown values are dropped, the
     * list is ordered, and "view" is added whenever anything else is granted.
     *
     * @param  iterable<string>  $abilities
     * @return list<string>
     */
    public static function normalize(iterable $abilities): array
    {
        $set = array_unique(array_intersect(self::values(), [...$abilities]));
        if ($set !== [] && ! in_array(self::View->value, $set, true)) {
            $set[] = self::View->value;
        }

        return array_values(array_intersect(self::values(), $set));
    }
}
