<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Helpdesk\Ticket;
use App\Models\Organization;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\AppCatalog;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class HelpdeskTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        $this->travelTo(now()->setDate(2026, 11, 6)->setTime(2, 0));
    }

    /** @return array{0: Organization, 1: User, 2: User} [org, staff requester, agent (staff role, listed in settings)] */
    private function desk(): array
    {
        $org = $this->createOrganization(null, 'Acme');
        AppCatalog::installDefaults($org, $this->owner($org));
        $staff = $this->addMember($org, Role::Staff);
        $agent = $this->addMember($org, Role::Staff);
        $this->actingAs($this->owner($org))->putJson($this->api($org, '/helpdesk/settings'), ['agent_ids' => [$agent->id]])->assertOk();

        return [$org, $staff, $agent];
    }

    private function raise(Organization $org, User $user, array $extra = []): int
    {
        return $this->actingAs($user)->postJson($this->api($org, '/helpdesk/tickets'), [
            'subject' => 'Laptop will not boot', 'description' => 'Black screen since this morning.', 'category' => 'IT', ...$extra,
        ])->assertCreated()->json('data.id');
    }

    private function notifications(User $user, string $type): int
    {
        return UserNotification::where('user_id', $user->id)->where('type', $type)->count();
    }

    public function test_member_raises_a_ticket_and_listed_agents_are_told(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $res = $this->actingAs($staff)->postJson($this->api($org, '/helpdesk/tickets'), [
            'subject' => 'Laptop will not boot', 'description' => 'Black screen.', 'priority' => 'high', 'category' => 'IT',
        ])->assertCreated()
            ->assertJsonPath('data.status', 'open')
            ->assertJsonPath('data.requester.id', $staff->id)
            ->assertJsonPath('data.sla.first_response.state', 'pending')
            ->assertJsonPath('data.permissions.work', false)
            ->assertJsonPath('data.permissions.resolve', true);
        $ticket = Ticket::findOrFail($res->json('data.id'));
        $this->assertSame('HD-'.str_pad((string) $ticket->id, 6, '0', STR_PAD_LEFT), $res->json('data.reference'));
        // High: 4 h to first response, 24 h to resolve.
        $this->assertTrue($ticket->first_response_due_at->eq(now()->addHours(4)));
        $this->assertTrue($ticket->resolution_due_at->eq(now()->addHours(24)));

        // Listed agents hear about it; Owners/Admins are not spammed when agents are listed.
        $this->assertSame(1, $this->notifications($agent, 'helpdesk.created'));
        $this->assertSame(0, $this->notifications($this->owner($org), 'helpdesk.created'));

        $this->actingAs($staff)->getJson($this->api($org, '/helpdesk/tickets'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($staff)->getJson($this->api($org, '/helpdesk/tickets?scope=all'))->assertForbidden();
        $this->actingAs($agent)->getJson($this->api($org, '/helpdesk/tickets?scope=unassigned'))->assertOk()->assertJsonPath('data.0.id', $ticket->id);
        $this->actingAs($agent)->getJson($this->api($org, '/helpdesk/summary'))->assertOk()
            ->assertJsonPath('data.is_agent', true)->assertJsonPath('data.counts.unassigned', 1);

        // Unknown category.
        $this->actingAs($staff)->postJson($this->api($org, '/helpdesk/tickets'), ['subject' => 'x', 'description' => 'y', 'category' => 'Spaceships'])
            ->assertJsonValidationErrors('category');
    }

    public function test_conversation_status_flow_and_internal_notes(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $id = $this->raise($org, $staff);
        $url = $this->api($org, "/helpdesk/tickets/{$id}");

        // Agent's first public reply: first response met, work in progress, requester told.
        $this->actingAs($agent)->postJson("{$url}/messages", ['body' => 'Can you hold the power button for 30 seconds?', 'status' => 'waiting'])->assertCreated()
            ->assertJsonPath('data.status', 'waiting')
            ->assertJsonPath('data.sla.first_response.state', 'met');
        $this->assertSame(1, $this->notifications($staff, 'helpdesk.reply'));

        // Internal note with a file: agents only.
        $file = $this->actingAs($agent)->postJson($this->api($org, '/attachments'), [
            'file' => UploadedFile::fake()->createWithContent('serial.txt', 'SN-123'),
        ])->assertCreated()->json('data.id');
        $this->actingAs($agent)->postJson("{$url}/messages", ['body' => 'Warranty expired last month.', 'internal' => true, 'attachment_ids' => [$file]])->assertCreated();
        $this->assertSame(0, $this->notifications($staff, 'helpdesk.note'));
        $this->actingAs($staff)->getJson($url)->assertOk()->assertJsonCount(1, 'data.messages')
            ->assertJsonPath('data.messages.0.internal', false);
        $this->actingAs($agent)->getJson($url)->assertOk()->assertJsonCount(2, 'data.messages');
        $this->actingAs($staff)->get($this->api($org, "/attachments/{$file}/download"))->assertNotFound();
        $this->actingAs($agent)->get($this->api($org, "/attachments/{$file}/download"))->assertOk();

        // Requester answers: back to the agents.
        $this->actingAs($staff)->postJson("{$url}/messages", ['body' => 'Done, still black.'])->assertCreated()->assertJsonPath('data.status', 'open');
        $this->assertSame(1, $this->notifications($agent, 'helpdesk.reply'));

        // Requester cannot write internal notes or change status by replying.
        $this->actingAs($staff)->postJson("{$url}/messages", ['body' => 'x', 'internal' => true])->assertForbidden();
        $this->actingAs($staff)->postJson("{$url}/messages", ['body' => 'x', 'status' => 'closed'])->assertForbidden();

        // Resolve → requester told; their reply reopens it.
        $this->actingAs($agent)->patchJson($url, ['status' => 'resolved', 'assignee_id' => $agent->id])->assertOk()
            ->assertJsonPath('data.status', 'resolved')->assertJsonPath('data.sla.resolution.state', 'met');
        $this->assertSame(1, $this->notifications($staff, 'helpdesk.resolved'));
        $this->actingAs($staff)->postJson("{$url}/messages", ['body' => 'It happened again.'])->assertCreated()
            ->assertJsonPath('data.status', 'in_progress')->assertJsonPath('data.resolved_at', null);

        // Closed: no more replies, requester cannot reopen; an agent can.
        $this->actingAs($agent)->patchJson($url, ['status' => 'closed'])->assertOk();
        $this->actingAs($staff)->postJson("{$url}/messages", ['body' => 'hello?'])->assertStatus(422);
        $this->actingAs($staff)->patchJson($url, ['status' => 'resolved'])->assertStatus(422);
        $this->actingAs($agent)->patchJson($url, ['status' => 'open'])->assertOk()->assertJsonPath('data.status', 'open');

        // Requesters see status history only.
        $events = collect($this->actingAs($staff)->getJson($url)->json('data.activity'))->pluck('event')->unique()->values()->all();
        $this->assertSame(['helpdesk.created', 'helpdesk.status_changed'], $events);
    }

    public function test_requester_can_only_resolve_their_own_ticket(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $id = $this->raise($org, $staff);
        $url = $this->api($org, "/helpdesk/tickets/{$id}");

        $this->actingAs($staff)->patchJson($url, ['priority' => 'urgent'])->assertForbidden();
        $this->actingAs($staff)->patchJson($url, ['assignee_id' => $agent->id])->assertForbidden();
        $this->actingAs($staff)->patchJson($url, ['status' => 'in_progress'])->assertForbidden();
        $this->actingAs($staff)->patchJson($url, ['status' => 'resolved'])->assertOk()->assertJsonPath('data.status', 'resolved');
        $this->actingAs($staff)->deleteJson($url)->assertForbidden();
    }

    public function test_who_can_see_a_ticket(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $colleague = $this->addMember($org, Role::Staff);
        $manager = $this->addMember($org, Role::Manager);
        $admin = $this->addMember($org, Role::Admin);
        $id = $this->raise($org, $staff);
        $url = $this->api($org, "/helpdesk/tickets/{$id}");

        $this->actingAs($staff)->getJson($url)->assertOk();
        $this->actingAs($agent)->getJson($url)->assertOk()->assertJsonPath('data.permissions.work', true)->assertJsonPath('data.permissions.delete', false);
        // Owners/Admins have the "edit" ability (agents) by default.
        $this->actingAs($admin)->getJson($url)->assertOk()->assertJsonPath('data.permissions.delete', true);
        $this->actingAs($colleague)->getJson($url)->assertNotFound();
        $this->actingAs($manager)->getJson($url)->assertNotFound();
        $this->actingAs($colleague)->postJson("{$url}/messages", ['body' => 'hi'])->assertNotFound();
        $this->actingAs($colleague)->patchJson($url, ['status' => 'resolved'])->assertNotFound();
        $this->actingAs($colleague)->getJson($this->api($org, '/helpdesk/tickets'))->assertOk()->assertJsonCount(0, 'data');

        // Other organisation: guessed IDs and cross-organisation URLs are 404.
        $other = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($other, $this->owner($other));
        $this->actingAs($this->owner($other))->getJson($url)->assertNotFound();
        $this->actingAs($this->owner($other))->getJson($this->api($other, "/helpdesk/tickets/{$id}"))->assertNotFound();
        $this->actingAs($this->owner($other))->postJson($this->api($other, "/helpdesk/tickets/{$id}/messages"), ['body' => 'x'])->assertNotFound();

        // Uninstalled: 404 for everyone.
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/admin/apps/helpdesk'))->assertSuccessful();
        $this->actingAs($staff)->getJson($url)->assertNotFound();
    }

    public function test_agents_raise_and_assign_with_checked_ids(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $outsider = $this->createOrganization(null, 'Other Co');
        $foreigner = $this->addMember($outsider, Role::Staff);

        // Requesters cannot raise for others or assign.
        $this->actingAs($staff)->postJson($this->api($org, '/helpdesk/tickets'), ['subject' => 's', 'description' => 'd', 'requester_id' => $agent->id])
            ->assertJsonValidationErrors('requester_id');
        $this->actingAs($staff)->postJson($this->api($org, '/helpdesk/tickets'), ['subject' => 's', 'description' => 'd', 'assignee_id' => $agent->id])
            ->assertJsonValidationErrors('assignee_id');

        // Agents: requester must be an active member here; assignee must be an agent.
        $this->actingAs($agent)->postJson($this->api($org, '/helpdesk/tickets'), ['subject' => 's', 'description' => 'd', 'requester_id' => $foreigner->id])
            ->assertJsonValidationErrors('requester_id');
        $this->actingAs($agent)->postJson($this->api($org, '/helpdesk/tickets'), ['subject' => 's', 'description' => 'd', 'requester_id' => $staff->id, 'assignee_id' => $staff->id])
            ->assertJsonValidationErrors('assignee_id');

        $id = $this->actingAs($agent)->postJson($this->api($org, '/helpdesk/tickets'), [
            'subject' => 'Phone call: printer jam', 'description' => 'Called the desk.', 'requester_id' => $staff->id, 'assignee_id' => $agent->id,
        ])->assertCreated()->assertJsonPath('data.status', 'in_progress')->assertJsonPath('data.assignee.id', $agent->id)->json('data.id');
        $this->assertSame(1, $this->notifications($staff, 'helpdesk.created'));
        $this->actingAs($staff)->getJson($this->api($org, "/helpdesk/tickets/{$id}"))->assertOk();

        $this->actingAs($agent)->patchJson($this->api($org, "/helpdesk/tickets/{$id}"), ['assignee_id' => $foreigner->id])->assertJsonValidationErrors('assignee_id');
        $ids = collect($this->actingAs($agent)->getJson($this->api($org, '/helpdesk/agents'))->assertOk()->json('data'))->pluck('id');
        $this->assertTrue($ids->contains($agent->id) && $ids->contains($this->owner($org)->id) && ! $ids->contains($staff->id));
        $this->actingAs($staff)->getJson($this->api($org, '/helpdesk/agents'))->assertForbidden();
    }

    public function test_sla_warnings_breaches_priority_changes_and_auto_close(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $id = $this->raise($org, $staff, ['priority' => 'urgent']); // 1 h / 8 h
        $ticket = Ticket::findOrFail($id);

        // Raising the priority moves the targets, counted from creation.
        $this->actingAs($agent)->patchJson($this->api($org, "/helpdesk/tickets/{$id}"), ['priority' => 'low'])->assertOk();
        $this->assertTrue($ticket->fresh()->first_response_due_at->eq($ticket->created_at->copy()->addHours(24)));
        $this->actingAs($agent)->patchJson($this->api($org, "/helpdesk/tickets/{$id}"), ['priority' => 'urgent'])->assertOk();

        Artisan::call('rakanspace:helpdesk-sla');
        $this->assertSame(1, $this->notifications($agent, 'helpdesk.sla_warning'));
        $this->travel(2)->hours();
        Artisan::call('rakanspace:helpdesk-sla');
        Artisan::call('rakanspace:helpdesk-sla');
        $this->assertSame(1, $this->notifications($agent, 'helpdesk.sla_breached'));
        $this->actingAs($agent)->getJson($this->api($org, "/helpdesk/tickets/{$id}"))->assertJsonPath('data.sla.first_response.state', 'missed');

        // Resolved tickets close after the quiet period (7 days by default).
        $this->actingAs($agent)->patchJson($this->api($org, "/helpdesk/tickets/{$id}"), ['status' => 'resolved'])->assertOk();
        $this->travel(6)->days();
        Artisan::call('rakanspace:helpdesk-sla');
        $this->assertSame('resolved', $ticket->fresh()->status);
        $this->travel(2)->days();
        Artisan::call('rakanspace:helpdesk-sla');
        $this->assertSame('closed', $ticket->fresh()->status);
    }

    public function test_settings_and_canned_responses(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $owner = $this->owner($org);
        $foreignOrg = $this->createOrganization(null, 'Other Co');
        AppCatalog::installDefaults($foreignOrg, $this->owner($foreignOrg));
        $foreigner = $this->addMember($foreignOrg, Role::Staff);

        $this->actingAs($agent)->getJson($this->api($org, '/helpdesk/settings'))->assertForbidden();
        $this->actingAs($owner)->putJson($this->api($org, '/helpdesk/settings'), ['agent_ids' => [$agent->id, $foreigner->id, 999999]])->assertOk()
            ->assertJsonCount(1, 'data.agents')->assertJsonPath('data.agents.0.id', $agent->id);
        $sla = ['urgent' => ['first_response_hours' => 2, 'resolution_hours' => 1]] + array_fill_keys(['high', 'medium', 'low'], ['first_response_hours' => 4, 'resolution_hours' => 8]);
        $this->actingAs($owner)->putJson($this->api($org, '/helpdesk/settings'), ['sla' => $sla])->assertJsonValidationErrors('sla.urgent.resolution_hours');
        $sla['urgent']['resolution_hours'] = 6;
        $this->actingAs($owner)->putJson($this->api($org, '/helpdesk/settings'), ['sla' => $sla, 'categories' => ['IT', 'Payroll'], 'auto_close_days' => 0])->assertOk()
            ->assertJsonPath('data.sla.urgent.resolution_hours', 6)->assertJsonPath('data.categories.1', 'Payroll');

        // Canned responses: admins manage, agents use, requesters cannot see.
        $canned = $this->actingAs($owner)->postJson($this->api($org, '/helpdesk/canned-responses'), ['title' => 'Restart', 'body' => 'Please restart and try again.'])
            ->assertCreated()->json('data.id');
        $this->actingAs($agent)->getJson($this->api($org, '/helpdesk/canned-responses'))->assertOk()->assertJsonPath('data.0.title', 'Restart');
        $this->actingAs($agent)->postJson($this->api($org, '/helpdesk/canned-responses'), ['title' => 'x', 'body' => 'y'])->assertForbidden();
        $this->actingAs($staff)->getJson($this->api($org, '/helpdesk/canned-responses'))->assertForbidden();
        $this->actingAs($this->owner($foreignOrg))->putJson($this->api($foreignOrg, "/helpdesk/canned-responses/{$canned}"), ['title' => 'x', 'body' => 'y'])->assertNotFound();
        $this->actingAs($owner)->deleteJson($this->api($org, "/helpdesk/canned-responses/{$canned}"))->assertNoContent();
    }

    public function test_removed_agent_hands_tickets_back_and_history_is_kept(): void
    {
        [$org, $staff, $agent] = $this->desk();
        $id = $this->raise($org, $staff);
        $this->actingAs($agent)->patchJson($this->api($org, "/helpdesk/tickets/{$id}"), ['assignee_id' => $agent->id])->assertOk()
            ->assertJsonPath('data.status', 'in_progress');
        $this->actingAs($agent)->postJson($this->api($org, "/helpdesk/tickets/{$id}/messages"), ['body' => 'Looking into it.'])->assertCreated();

        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/members/'.$this->membership($org, $agent)->id))->assertSuccessful();

        $ticket = Ticket::findOrFail($id);
        $this->assertNull($ticket->assignee_id);
        $this->assertSame('open', $ticket->status);
        $this->assertSame($agent->id, $ticket->messages()->first()->author_id);
        $this->assertDatabaseMissing('helpdesk_agents', ['organization_id' => $org->id, 'user_id' => $agent->id]);
    }

    public function test_deleting_a_ticket_detaches_its_files(): void
    {
        [$org, $staff] = $this->desk();
        $file = $this->actingAs($staff)->postJson($this->api($org, '/attachments'), [
            'file' => UploadedFile::fake()->createWithContent('screen.txt', 'error 42'),
        ])->assertCreated()->json('data.id');
        $id = $this->raise($org, $staff, ['attachment_ids' => [$file]]);
        $this->actingAs($staff)->getJson($this->api($org, "/helpdesk/tickets/{$id}"))->assertJsonPath('data.attachments.0.id', $file);

        $this->actingAs($this->owner($org))->deleteJson($this->api($org, "/helpdesk/tickets/{$id}"))->assertNoContent();
        $this->assertDatabaseMissing('helpdesk_tickets', ['id' => $id]);
        $this->assertDatabaseHas('attachments', ['id' => $file, 'attachable_type' => null]);
    }
}
