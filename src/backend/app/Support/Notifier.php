<?php

namespace App\Support;

use App\Jobs\DeliverNotifications;

/**
 * Entry point for in-app notifications. Fan-out happens on the queue after the
 * surrounding transaction commits.
 */
class Notifier
{
    /**
     * @param  iterable<int>  $userIds  Recipients; inactive members and the actor are skipped.
     * @param  string|null  $dedupeKey  Same key + same user is stored only once.
     */
    public static function send(
        int $organizationId,
        iterable $userIds,
        string $type,
        string $title,
        ?string $body = null,
        ?string $link = null,
        ?int $actorId = null,
        ?string $dedupeKey = null,
        array $data = [],
    ): void {
        $ids = collect($userIds)->map(fn ($id) => (int) $id)->unique()
            ->reject(fn ($id) => $actorId !== null && $id === $actorId)
            ->values()->all();

        if ($ids === []) {
            return;
        }

        DeliverNotifications::dispatch($organizationId, $ids, $type, $title, $body, $link, $actorId, $dedupeKey, $data)
            ->afterCommit();
    }
}
