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
     * @param  string|null  $link  Workspace-relative path, e.g. "/projects/3".
     * @param  string|null  $dedupeKey  Same key + same user is stored only once.
     * @param  bool  $email  Also send a queued email copy to recipients that got a new notification.
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
        bool $email = false,
    ): void {
        $ids = collect($userIds)->map(fn ($id) => (int) $id)->unique()
            ->reject(fn ($id) => $actorId !== null && $id === $actorId)
            ->values()->all();

        if ($ids === []) {
            return;
        }

        DeliverNotifications::dispatch($organizationId, $ids, $type, $title, $body, $link, $actorId, $dedupeKey, $data, $email)
            ->afterCommit();
    }
}
