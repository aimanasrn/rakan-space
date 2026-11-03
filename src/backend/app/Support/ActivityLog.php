<?php

namespace App\Support;

use App\Models\Activity;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;

/**
 * Records activity history and administrative audit events.
 * Never store message bodies, passwords or tokens in properties.
 */
class ActivityLog
{
    public static function record(
        int $organizationId,
        ?User $actor,
        string $event,
        ?Model $subject = null,
        array $properties = [],
        ?int $projectId = null,
        bool $audit = false,
    ): Activity {
        return Activity::create([
            'organization_id' => $organizationId,
            'actor_id' => $actor?->id,
            'event' => $event,
            'subject_type' => $subject?->getMorphClass(),
            'subject_id' => $subject?->getKey(),
            'project_id' => $projectId,
            'is_audit' => $audit,
            'properties' => $properties ?: null,
        ]);
    }

    public static function audit(int $organizationId, ?User $actor, string $event, ?Model $subject = null, array $properties = []): Activity
    {
        return self::record($organizationId, $actor, $event, $subject, $properties, null, true);
    }
}
