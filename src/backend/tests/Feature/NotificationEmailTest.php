<?php

namespace Tests\Feature;

use App\Mail\NotificationMail;
use App\Support\Notifier;
use Illuminate\Support\Facades\Mail;
use Tests\TestCase;

class NotificationEmailTest extends TestCase
{
    public function test_email_copy_is_queued_once_per_new_notification(): void
    {
        Mail::fake();
        $org = $this->createOrganization();
        $staff = $this->addMember($org);

        Notifier::send($org->id, [$staff->id], 'test', 'Leave approved', 'Enjoy your break', '/apps/approval', dedupeKey: 'k1', email: true);
        Notifier::send($org->id, [$staff->id], 'test', 'Leave approved', 'Enjoy your break', '/apps/approval', dedupeKey: 'k1', email: true);

        Mail::assertQueued(NotificationMail::class, 1);
        Mail::assertQueued(NotificationMail::class, fn (NotificationMail $m) => $m->hasTo($staff->email)
            && $m->url === 'http://localhost:3000/w/'.$org->slug.'/apps/approval');
    }

    public function test_no_email_unless_requested_or_for_inactive_members(): void
    {
        Mail::fake();
        $org = $this->createOrganization();
        $staff = $this->addMember($org);
        $gone = $this->addMember($org);
        $this->membership($org, $gone)->update(['status' => 'removed']);

        Notifier::send($org->id, [$staff->id], 'test', 'In-app only');
        Notifier::send($org->id, [$gone->id], 'test', 'Not for you', email: true);

        Mail::assertNothingQueued();
        $this->assertDatabaseHas('user_notifications', ['user_id' => $staff->id, 'title' => 'In-app only']);
    }
}
