<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\UserNotification;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class SearchAndNotificationTest extends TestCase
{
    public function test_search_never_reveals_inaccessible_resources(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $manager = $this->addMember($org, Role::Manager);

        $private = $this->createChannel($org, $owner, [], 'private', 'merger');
        $private->messages()->create(['organization_id' => $org->id, 'user_id' => $owner->id, 'client_id' => fake()->uuid(), 'body' => 'Project Kenari acquisition terms']);
        $public = $this->createChannel($org, $owner, [], 'public', 'general');
        $public->messages()->create(['organization_id' => $org->id, 'user_id' => $owner->id, 'client_id' => fake()->uuid(), 'body' => 'Kenari launch party on Friday']);
        $restricted = $this->createProject($org, $manager);
        $restricted->update(['name' => 'Kenari secret project']);
        $this->createTask($restricted, null, ['title' => 'Kenari due diligence']);

        $result = $this->actingAs($staff)->getJson($this->api($org, '/search?q=kenari'))->assertOk();
        $result->assertJsonPath('data.messages.total', 1)
            ->assertJsonPath('data.projects.total', 0)
            ->assertJsonPath('data.tasks.total', 0)
            ->assertJsonPath('data.channels.total', 0);
        $this->assertStringContainsString('launch party', $result->json('data.messages.items.0.snippet'));
        $this->assertStringNotContainsString('acquisition', json_encode($result->json()));

        $this->actingAs($manager)->getJson($this->api($org, '/search?q=kenari'))
            ->assertJsonPath('data.projects.total', 1)->assertJsonPath('data.tasks.total', 1);
    }

    public function test_reminders_are_not_duplicated_across_runs(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $guest = $this->addMember($org);
        $project = $this->createProject($org, $owner, [$guest]);
        $this->createTask($project, $guest, ['due_date' => now($org->timezone)->addDay()->toDateString()]);

        $event = $org->events()->create([
            'title' => 'Standup', 'starts_at' => now()->addMinutes(10), 'ends_at' => now()->addMinutes(25),
            'audience' => 'participants', 'reminder_minutes' => 15, 'created_by' => $owner->id,
        ]);
        $event->participants()->sync([$owner->id, $guest->id]);

        Artisan::call('rakanspace:send-reminders');
        Artisan::call('rakanspace:send-reminders');

        $this->assertSame(1, UserNotification::where('user_id', $guest->id)->where('type', 'event.reminder')->count());
        $this->assertSame(1, UserNotification::where('user_id', $owner->id)->where('type', 'event.reminder')->count());
        $this->assertSame(1, UserNotification::where('user_id', $guest->id)->where('type', 'task.due')->count());
    }

    public function test_notification_read_states_are_per_user_and_organisation(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $other = $this->createOrganization($owner, 'Second');
        foreach ([$org, $other] as $o) {
            UserNotification::create(['user_id' => $owner->id, 'organization_id' => $o->id, 'type' => 'test', 'title' => 'Hello']);
        }

        $this->actingAs($owner)->getJson($this->api($org, '/notifications/unread-count'))->assertJsonPath('data.unread_count', 1);
        $this->postJson($this->api($org, '/notifications/read-all'))->assertOk()->assertJsonPath('updated', 1);
        $this->getJson($this->api($other, '/notifications/unread-count'))->assertJsonPath('data.unread_count', 1);

        // Another user's notification id cannot be marked from this account.
        $intruder = $this->addMember($org);
        $foreign = UserNotification::where('organization_id', $other->id)->first();
        $this->actingAs($intruder)->postJson($this->api($org, "/notifications/{$foreign->id}/read"))->assertNotFound();
        $this->assertNull($foreign->fresh()->read_at);
    }
}
