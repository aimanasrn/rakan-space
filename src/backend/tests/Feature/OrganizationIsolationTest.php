<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Attachment;
use App\Models\User;
use Tests\TestCase;

class OrganizationIsolationTest extends TestCase
{
    public function test_non_members_get_404_for_another_organisation(): void
    {
        $orgA = $this->createOrganization(null, 'Alpha');
        $outsider = $this->owner($this->createOrganization(null, 'Beta'));

        $this->actingAs($outsider)->getJson($this->api($orgA))->assertNotFound();
        $this->actingAs($outsider)->getJson($this->api($orgA, '/projects'))->assertNotFound();
        $this->actingAs($outsider)->getJson($this->api($orgA, '/members'))->assertNotFound();
        $this->actingAs($outsider)->getJson($this->api($orgA, '/conversations'))->assertNotFound();
    }

    public function test_guessed_resource_ids_from_another_organisation_resolve_to_404(): void
    {
        $orgA = $this->createOrganization(null, 'Alpha');
        $ownerA = $this->owner($orgA);
        $project = $this->createProject($orgA, $ownerA, [], 'organization');
        $task = $this->createTask($project);
        $channel = $this->createChannel($orgA, $ownerA, [], 'public');
        $message = $channel->messages()->create(['organization_id' => $orgA->id, 'user_id' => $ownerA->id, 'client_id' => fake()->uuid(), 'body' => 'secret plan']);
        $event = $orgA->events()->create(['title' => 'Board', 'starts_at' => now()->addDay(), 'ends_at' => now()->addDay()->addHour(), 'audience' => 'everyone', 'created_by' => $ownerA->id]);
        $announcement = $orgA->announcements()->create(['title' => 'Hi', 'body' => 'x', 'author_id' => $ownerA->id]);
        $file = Attachment::create(['organization_id' => $orgA->id, 'uploader_id' => $ownerA->id, 'attachable_type' => 'project', 'attachable_id' => $project->id,
            'disk' => 'local', 'path' => 'attachments/x.pdf', 'original_name' => 'x.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf', 'size' => 10]);

        // The attacker is an owner of their own organisation and uses its slug.
        $orgB = $this->createOrganization(null, 'Beta');
        $attacker = $this->owner($orgB);
        $this->actingAs($attacker);

        $this->getJson($this->api($orgB, "/projects/{$project->id}"))->assertNotFound();
        $this->getJson($this->api($orgB, "/tasks/{$task->id}"))->assertNotFound();
        $this->patchJson($this->api($orgB, "/tasks/{$task->id}"), ['title' => 'pwned'])->assertNotFound();
        $this->getJson($this->api($orgB, "/conversations/{$channel->id}/messages"))->assertNotFound();
        $this->postJson($this->api($orgB, "/conversations/{$channel->id}/messages"), ['client_id' => fake()->uuid(), 'body' => 'hi'])->assertNotFound();
        $this->deleteJson($this->api($orgB, "/conversations/{$channel->id}/messages/{$message->id}"))->assertNotFound();
        $this->getJson($this->api($orgB, "/events/{$event->id}"))->assertNotFound();
        $this->getJson($this->api($orgB, "/announcements/{$announcement->id}"))->assertNotFound();
        $this->getJson($this->api($orgB, "/attachments/{$file->id}/download"))->assertNotFound();

        $this->assertSame('Task', substr($task->fresh()->title, 0, 4));
    }

    public function test_lists_never_include_other_organisation_data(): void
    {
        $orgA = $this->createOrganization(null, 'Alpha');
        $ownerA = $this->owner($orgA);
        $this->createProject($orgA, $ownerA, [], 'organization');
        $this->createChannel($orgA, $ownerA, [], 'public', 'alpha-news');

        $orgB = $this->createOrganization(null, 'Beta');
        $ownerB = $this->owner($orgB);

        $this->actingAs($ownerB);
        $this->getJson($this->api($orgB, '/projects'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->api($orgB, '/tasks'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->api($orgB, '/conversations/browse'))->assertOk()->assertJsonCount(0, 'data');
        $this->getJson($this->api($orgB, '/search?q=alpha'))->assertOk()
            ->assertJsonPath('data.channels.total', 0)->assertJsonPath('data.projects.total', 0);
    }

    public function test_user_can_hold_different_roles_in_different_organisations(): void
    {
        $person = User::factory()->create();
        $orgA = $this->createOrganization($person, 'Alpha');
        $orgB = $this->createOrganization(null, 'Beta');
        $this->addMember($orgB, Role::Staff, $person);

        $this->actingAs($person);
        $this->getJson($this->api($orgA))->assertJsonPath('data.membership.role', 'owner');
        $this->getJson($this->api($orgB))->assertJsonPath('data.membership.role', 'staff')
            ->assertJsonPath('data.permissions.manage_members', false);
        $this->getJson('/api/auth/user')->assertJsonCount(2, 'data.organizations');
    }
}
