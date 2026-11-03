<?php

namespace Tests\Feature;

use App\Events\ConversationMessageChanged;
use App\Events\UserEvent;
use App\Models\Message;
use Illuminate\Broadcasting\BroadcastManager;
use Illuminate\Support\Facades\Event;
use Tests\TestCase;

class MessagingTest extends TestCase
{
    public function test_retrying_a_send_with_the_same_client_id_does_not_duplicate(): void
    {
        Event::fake([ConversationMessageChanged::class]);
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $channel = $this->createChannel($org, $owner);
        $clientId = fake()->uuid();

        $first = $this->actingAs($owner)->postJson($this->api($org, "/conversations/{$channel->id}/messages"), [
            'client_id' => $clientId, 'body' => 'Hello team',
        ])->assertCreated()->assertJsonPath('data.client_id', $clientId);

        $retry = $this->postJson($this->api($org, "/conversations/{$channel->id}/messages"), [
            'client_id' => $clientId, 'body' => 'Hello team',
        ])->assertOk()->assertJsonPath('duplicate', true);

        $this->assertSame($first->json('data.id'), $retry->json('data.id'));
        $this->assertSame(1, Message::where('client_id', $clientId)->count());
        // Only the original send is broadcast; the event carries identifiers, not content.
        Event::assertDispatchedTimes(ConversationMessageChanged::class, 1);
        Event::assertDispatched(ConversationMessageChanged::class, fn ($e) => $e->clientId === $clientId
            && ! array_key_exists('body', $e->broadcastWith()));
    }

    public function test_public_channels_are_readable_but_posting_requires_joining(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $public = $this->createChannel($org, $owner, [], 'public');

        $this->actingAs($staff);
        $this->getJson($this->api($org, "/conversations/{$public->id}/messages"))->assertOk();
        $this->postJson($this->api($org, "/conversations/{$public->id}/messages"), ['client_id' => fake()->uuid(), 'body' => 'hi'])->assertForbidden();
        $this->postJson($this->api($org, "/conversations/{$public->id}/join"))->assertOk()->assertJsonPath('data.permissions.post', true);
        $this->postJson($this->api($org, "/conversations/{$public->id}/messages"), ['client_id' => fake()->uuid(), 'body' => 'hi'])->assertCreated();
    }

    public function test_edit_delete_pagination_and_reconnection_recovery(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $peer = $this->addMember($org);
        $channel = $this->createChannel($org, $owner, [$peer]);

        $ids = [];
        foreach (range(1, 5) as $i) {
            $ids[] = $this->actingAs($owner)->postJson($this->api($org, "/conversations/{$channel->id}/messages"), [
                'client_id' => fake()->uuid(), 'body' => "Message {$i}",
            ])->json('data.id');
        }

        // Older page, newest-last ordering.
        $page = $this->actingAs($peer)->getJson($this->api($org, "/conversations/{$channel->id}/messages?limit=2"))
            ->assertOk()->assertJsonPath('meta.has_more', true);
        $this->assertSame([$ids[3], $ids[4]], array_column($page->json('data'), 'id'));

        // After reconnecting, fetch everything after the last seen message.
        $missed = $this->getJson($this->api($org, "/conversations/{$channel->id}/messages?after={$ids[1]}"))->assertOk();
        $this->assertSame([$ids[2], $ids[3], $ids[4]], array_column($missed->json('data'), 'id'));

        // Unread count and mark-as-read.
        $this->getJson($this->api($org, '/conversations'))->assertJsonPath('data.0.unread_count', 5);
        $this->postJson($this->api($org, "/conversations/{$channel->id}/read"), ['message_id' => $ids[4]])->assertOk();
        $this->getJson($this->api($org, '/conversations'))->assertJsonPath('data.0.unread_count', 0);

        // Only the author edits; deleted messages show a deleted state without content.
        $this->patchJson($this->api($org, "/conversations/{$channel->id}/messages/{$ids[0]}"), ['body' => 'hack'])->assertForbidden();
        $this->actingAs($owner)->patchJson($this->api($org, "/conversations/{$channel->id}/messages/{$ids[0]}"), ['body' => 'Edited'])
            ->assertOk()->assertJsonPath('data.edited', true)->assertJsonPath('data.body', 'Edited');
        $this->deleteJson($this->api($org, "/conversations/{$channel->id}/messages/{$ids[1]}"))
            ->assertOk()->assertJsonPath('data.deleted', true)->assertJsonPath('data.body', null);
    }

    public function test_mentions_only_notify_people_who_can_read_the_conversation(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $member = $this->addMember($org);
        $outsider = $this->addMember($org);
        $private = $this->createChannel($org, $owner, [$member]);

        $this->actingAs($owner)->postJson($this->api($org, "/conversations/{$private->id}/messages"), [
            'client_id' => fake()->uuid(), 'body' => '@member @outsider', 'mentions' => [$member->id, $outsider->id],
        ])->assertCreated();

        $this->assertDatabaseHas('user_notifications', ['user_id' => $member->id, 'type' => 'mention']);
        $this->assertDatabaseMissing('user_notifications', ['user_id' => $outsider->id]);
    }

    public function test_direct_conversations_are_unique_per_pair(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $peer = $this->addMember($org);

        $a = $this->actingAs($owner)->postJson($this->api($org, '/direct-conversations'), ['user_id' => $peer->id])->assertOk()->json('data.id');
        $b = $this->actingAs($peer)->postJson($this->api($org, '/direct-conversations'), ['user_id' => $owner->id])->assertOk()->json('data.id');
        $this->assertSame($a, $b);
    }

    public function test_realtime_channel_authorisation_rejects_unauthorised_subscriptions(): void
    {
        config([
            'broadcasting.default' => 'reverb',
            'broadcasting.connections.reverb.key' => 'test-key',
            'broadcasting.connections.reverb.secret' => 'test-secret',
            'broadcasting.connections.reverb.app_id' => 'test-app',
        ]);
        app(BroadcastManager::class)->forgetDrivers();
        require base_path('routes/channels.php');
        // Only subscription authorisation is under test; do not publish to a live Reverb server.
        Event::fake([ConversationMessageChanged::class, UserEvent::class]);

        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $member = $this->addMember($org);
        $outsider = $this->addMember($org);
        $private = $this->createChannel($org, $owner, [$member]);
        $foreigner = $this->owner($this->createOrganization(null, 'Other'));

        $auth = fn ($user, $channel) => $this->actingAs($user)->postJson('/api/broadcasting/auth', [
            'socket_id' => '1234.5678', 'channel_name' => $channel,
        ]);

        $auth($member, 'private-conversation.'.$private->id)->assertOk()->assertJsonStructure(['auth']);
        $auth($outsider, 'private-conversation.'.$private->id)->assertForbidden();
        $auth($foreigner, 'private-conversation.'.$private->id)->assertForbidden();
        $auth($member, 'private-user.'.$outsider->id)->assertForbidden();
        $auth($member, 'private-user.'.$member->id)->assertOk();

        // Revocation: once removed from the channel the next subscription is refused.
        $this->actingAs($owner)->deleteJson($this->api($org, "/conversations/{$private->id}/members/{$member->id}"))->assertOk();
        $auth($member, 'private-conversation.'.$private->id)->assertForbidden();
    }
}
