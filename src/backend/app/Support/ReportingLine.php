<?php

namespace App\Support;

use App\Models\OrganizationMembership;

/**
 * Reporting lines inside one organisation (membership.manager_id).
 * Used by approval routing ("reporting manager" approvers) in later modules.
 */
class ReportingLine
{
    /** The user's active reporting manager in the organisation, if any. */
    public static function managerOf(int $organizationId, int $userId): ?int
    {
        $managerId = OrganizationMembership::where('organization_id', $organizationId)
            ->where('user_id', $userId)->value('manager_id');

        if (! $managerId) {
            return null;
        }

        $active = OrganizationMembership::where('organization_id', $organizationId)
            ->where('user_id', $managerId)
            ->where('status', OrganizationMembership::STATUS_ACTIVE)
            ->exists();

        return $active ? (int) $managerId : null;
    }

    /** True when making $managerId the manager of $userId would create a loop. */
    public static function wouldCreateCycle(int $organizationId, int $userId, int $managerId): bool
    {
        $seen = [];
        $current = $managerId;
        while ($current !== null && ! isset($seen[$current])) {
            if ($current === $userId) {
                return true;
            }
            $seen[$current] = true;
            $next = OrganizationMembership::where('organization_id', $organizationId)
                ->where('user_id', $current)->value('manager_id');
            $current = $next ? (int) $next : null;
        }

        return false;
    }
}
