<?php

namespace App\Jobs;

use App\Events\UserEvent;
use App\Mail\NotificationMail;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\User;
use Illuminate\Contracts\Queue\ShouldQueue;
use Illuminate\Foundation\Queue\Queueable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Str;
use Throwable;

/**
 * Persists notifications (deduplicated per user by dedupe_key) and pushes a
 * lightweight real-time signal. Persisted rows remain the source of truth.
 */
class DeliverNotifications implements ShouldQueue
{
    use Queueable;

    public int $tries = 3;

    public array $backoff = [10, 60];

    /** @param list<int> $userIds */
    public function __construct(
        public int $organizationId,
        public array $userIds,
        public string $type,
        public string $title,
        public ?string $body,
        public ?string $link,
        public ?int $actorId,
        public ?string $dedupeKey,
        public array $data = [],
        public bool $email = false,
    ) {
        $this->onQueue('notifications');
    }

    public function handle(): void
    {
        // Only current, active members receive notifications.
        $recipients = OrganizationMembership::query()
            ->where('organization_id', $this->organizationId)
            ->where('status', OrganizationMembership::STATUS_ACTIVE)
            ->whereIn('user_id', $this->userIds)
            ->pluck('user_id');

        foreach ($recipients as $userId) {
            $id = (string) Str::uuid();
            $inserted = DB::table('user_notifications')->insertOrIgnore([
                'id' => $id,
                'user_id' => $userId,
                'organization_id' => $this->organizationId,
                'type' => $this->type,
                'title' => Str::limit($this->title, 245),
                'body' => $this->body !== null ? Str::limit($this->body, 495) : null,
                'link' => $this->link,
                'data' => $this->data ? json_encode($this->data) : null,
                'dedupe_key' => $this->dedupeKey,
                'actor_id' => $this->actorId,
                'created_at' => now(),
            ]);

            if ($inserted > 0) {
                if ($this->email) {
                    $this->sendEmail((int) $userId);
                }
                UserEvent::dispatch((int) $userId, 'notification.created', [
                    'organization_id' => $this->organizationId,
                    'notification_id' => $id,
                ]);
            }
        }
    }

    /** Queues an email copy. Only the title, short body and link are included. */
    private function sendEmail(int $userId): void
    {
        $user = User::find($userId);
        $organization = Organization::find($this->organizationId);
        if (! $user || ! $organization) {
            return;
        }

        $url = $this->link !== null
            ? config('rakanspace.frontend_url').'/w/'.$organization->slug.$this->link
            : null;

        Mail::to($user)->queue(new NotificationMail($organization->name, $this->title, $this->body !== null ? Str::limit($this->body, 495) : null, $url));
    }

    public function failed(Throwable $e): void
    {
        Log::error('Notification delivery failed', [
            'type' => $this->type,
            'organization_id' => $this->organizationId,
            'recipients' => count($this->userIds),
            'error' => $e->getMessage(),
        ]);
    }
}
