<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\OrganizationMembership;
use Tests\TestCase;

class MembershipRemovalTest extends TestCase
{
    public function test_removal_revokes_access_immediately_and_preserves_history(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $leaver = $this->addMember($org);
        $channel = $this->createChannel($org, $owner, [$leaver]);
        $project = $this->createProject($org, $owner, [$leaver]);
        $openTask = $this->createTask($project, $leaver);
        $doneTask = $this->createTask($project, $leaver, ['status' => 'done']);

        $this->actingAs($leaver)->postJson($this->api($org, "/conversations/{$channel->id}/messages"), [
            'client_id' => fake()->uuid(), 'body' => 'Before I go',
        ])->assertCreated();

        // The same user also belongs to another organisation.
        $other = $this->createOrganization(null, 'Other Co');
        $this->addMember($other, Role::Manager, $leaver);

        $this->actingAs($owner)->deleteJson($this->api($org, '/members/'.$this->membership($org, $leaver)->id))->assertOk();

        // Immediate revocation, even for the same authenticated session.
        $leaver->forgetMembershipCache();
        $this->actingAs($leaver);
        $this->getJson($this->api($org))->assertNotFound();
        $this->getJson($this->api($org, "/conversations/{$channel->id}/messages"))->assertNotFound();
        $this->getJson($this->api($org, "/projects/{$project->id}"))->assertNotFound();

        // History preserved.
        $this->assertDatabaseHas('messages', ['conversation_id' => $channel->id, 'user_id' => $leaver->id, 'body' => 'Before I go']);
        $this->assertNull($openTask->fresh()->assignee_id);
        $this->assertSame($leaver->id, $doneTask->fresh()->assignee_id);
        $this->assertDatabaseHas('activities', ['event' => 'member.removed', 'is_audit' => true]);
        $this->assertDatabaseMissing('conversation_members', ['conversation_id' => $channel->id, 'user_id' => $leaver->id]);

        // Other organisation untouched.
        $this->getJson($this->api($other))->assertOk()->assertJsonPath('data.membership.role', 'manager');
        $this->assertSame(OrganizationMembership::STATUS_REMOVED, $this->membership($org, $leaver)->status);
    }

    public function test_deactivated_members_lose_access_and_can_be_reactivated(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $membership = $this->membership($org, $staff);

        $this->actingAs($owner)->postJson($this->api($org, "/members/{$membership->id}/deactivate"))->assertOk();
        $staff->forgetMembershipCache();
        $this->actingAs($staff)->getJson($this->api($org, '/projects'))->assertNotFound();

        $this->actingAs($owner)->postJson($this->api($org, "/members/{$membership->id}/reactivate"))->assertOk();
        $staff->forgetMembershipCache();
        $this->actingAs($staff)->getJson($this->api($org, '/projects'))->assertOk();
    }

    public function test_removed_user_cannot_be_notified_or_assigned(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $project = $this->createProject($org, $owner, [$staff]);

        $this->actingAs($owner)->deleteJson($this->api($org, '/members/'.$this->membership($org, $staff)->id))->assertOk();

        $this->actingAs($owner)->postJson($this->api($org, "/projects/{$project->id}/tasks"), [
            'title' => 'Follow up', 'assignee_id' => $staff->id,
        ])->assertStatus(422);
    }
}
