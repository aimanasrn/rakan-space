<?php

namespace App\Enums;

/**
 * Organisation-level role. Roles belong to memberships, never to the user globally.
 */
enum Role: string
{
    case Owner = 'owner';
    case Admin = 'admin';
    case Manager = 'manager';
    case Staff = 'staff';

    public function rank(): int
    {
        return match ($this) {
            self::Owner => 4,
            self::Admin => 3,
            self::Manager => 2,
            self::Staff => 1,
        };
    }

    public function atLeast(self $role): bool
    {
        return $this->rank() >= $role->rank();
    }

    /** Can manage members, departments and organisation settings. */
    public function isAdministrator(): bool
    {
        return $this->atLeast(self::Admin);
    }

    /**
     * Roles this role may grant through invitations or role changes.
     * Owner status is only granted by an Owner (promotion or transfer).
     *
     * @return list<self>
     */
    public function assignableRoles(): array
    {
        return match ($this) {
            self::Owner => [self::Owner, self::Admin, self::Manager, self::Staff],
            self::Admin => [self::Manager, self::Staff],
            default => [],
        };
    }

    public function canAssign(self $role): bool
    {
        return in_array($role, $this->assignableRoles(), true);
    }

    public function label(): string
    {
        return ucfirst($this->value);
    }

    /** @return list<string> */
    public static function values(): array
    {
        return array_map(fn (self $r) => $r->value, self::cases());
    }
}
