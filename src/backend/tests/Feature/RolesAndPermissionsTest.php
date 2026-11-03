<?php

namespace Tests\Feature;

use App\Enums\Role;
use Tests\TestCase;

class RolesAndPermissionsTest extends TestCase
{
    public function test_staff_cannot_create_projects_or_manage_members(): void
    {
        $org = $this->createOrganization();
        $staff = $this->addMember($org, Role::Staff);
        $other = $this->addMember($org, Role::Staff);

        $this->actingAs($staff);
        $this->postJson($this->api($org, '/projects'), ['name' => 'Nope'])->assertForbidden();
        $this->postJson($this->api($org, '/invitations'), ['email' => 'x@example.com', 'role' => 'staff'])->assertForbidden();
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $other)->id), ['role' => 'manager'])->assertForbidden();
        $this->getJson($this->api($org, '/reports'))->assertForbidden();
        $this->postJson($this->api($org, '/announcements'), ['title' => 'x', 'body' => 'y', 'audience' => 'organization'])->assertForbidden();
    }

    public function test_manager_can_create_projects_and_view_reports(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);

        $this->actingAs($manager)->postJson($this->api($org, '/projects'), ['name' => 'Website revamp'])
            ->assertCreated()->assertJsonPath('data.manager.id', $manager->id)->assertJsonPath('data.permissions.manage', true);
        $this->getJson($this->api($org, '/reports'))->assertOk();
    }

    public function test_private_channels_are_not_visible_to_owners_or_admins_who_are_not_members(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $admin = $this->addMember($org, Role::Admin);
        $a = $this->addMember($org);
        $b = $this->addMember($org);
        $private = $this->createChannel($org, $a, [$b]);
        $private->messages()->create(['organization_id' => $org->id, 'user_id' => $a->id, 'client_id' => fake()->uuid(), 'body' => 'confidential salary talk']);
        $dm = $org->conversations()->create(['type' => 'direct', 'visibility' => 'private', 'direct_key' => min($a->id, $b->id).':'.max($a->id, $b->id)]);
        $dm->memberships()->createMany([['user_id' => $a->id], ['user_id' => $b->id]]);

        foreach ([$owner, $admin] as $boss) {
            $this->actingAs($boss);
            $this->getJson($this->api($org, "/conversations/{$private->id}/messages"))->assertNotFound();
            $this->getJson($this->api($org, "/conversations/{$dm->id}/messages"))->assertNotFound();
            $this->postJson($this->api($org, "/conversations/{$private->id}/join"))->assertNotFound();
            $this->getJson($this->api($org, '/search?q=salary'))->assertJsonPath('data.messages.total', 0);
        }

        $this->actingAs($b)->getJson($this->api($org, "/conversations/{$private->id}/messages"))->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_restricted_projects_require_project_membership_for_staff(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $insider = $this->addMember($org);
        $outsider = $this->addMember($org);
        $admin = $this->addMember($org, Role::Admin);
        $project = $this->createProject($org, $manager, [$insider]);

        $this->actingAs($outsider)->getJson($this->api($org, "/projects/{$project->id}"))->assertNotFound();
        $this->actingAs($outsider)->getJson($this->api($org, '/projects'))->assertJsonCount(0, 'data');
        $this->actingAs($insider)->getJson($this->api($org, "/projects/{$project->id}"))->assertOk();
        $this->actingAs($admin)->getJson($this->api($org, "/projects/{$project->id}"))->assertOk();

        $project->update(['visibility' => 'organization']);
        $this->actingAs($outsider)->getJson($this->api($org, "/projects/{$project->id}"))->assertOk()
            ->assertJsonPath('data.permissions.contribute', false);
        $this->actingAs($outsider)->postJson($this->api($org, "/projects/{$project->id}/tasks"), ['title' => 'x'])->assertForbidden();
    }

    public function test_role_assignment_cannot_escalate_privileges(): void
    {
        $org = $this->createOrganization();
        $admin = $this->addMember($org, Role::Admin);
        $otherAdmin = $this->addMember($org, Role::Admin);
        $staff = $this->addMember($org);

        $this->actingAs($admin);
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $staff)->id), ['role' => 'admin'])->assertForbidden();
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $staff)->id), ['role' => 'owner'])->assertForbidden();
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $otherAdmin)->id), ['role' => 'staff'])->assertForbidden();
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $admin)->id), ['role' => 'owner'])->assertForbidden();
        $this->patchJson($this->api($org, '/members/'.$this->membership($org, $staff)->id), ['role' => 'manager'])->assertOk()
            ->assertJsonPath('data.role', 'manager');

        $this->assertDatabaseHas('activities', ['event' => 'member.role_changed', 'is_audit' => true]);
    }

    public function test_final_owner_cannot_be_demoted_or_removed_without_transfer(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $admin = $this->addMember($org, Role::Admin);

        // Owner cannot leave or be removed while they are the only owner.
        $this->actingAs($owner)->deleteJson($this->api($org, '/members/'.$this->membership($org, $owner)->id))->assertStatus(422);
        $this->actingAs($admin)->deleteJson($this->api($org, '/members/'.$this->membership($org, $owner)->id))->assertForbidden();

        // A co-owner cannot demote the last remaining other owner either once alone.
        $coOwner = $this->addMember($org, Role::Owner);
        $this->actingAs($coOwner)->patchJson($this->api($org, '/members/'.$this->membership($org, $owner)->id), ['role' => 'admin'])->assertOk();
        $this->actingAs($coOwner)->deleteJson($this->api($org, '/members/'.$this->membership($org, $coOwner)->id))->assertStatus(422);

        // Transfer ownership: co-owner -> admin; co-owner becomes admin.
        $this->actingAs($coOwner)->postJson($this->api($org, '/transfer-ownership'), [
            'membership_id' => $this->membership($org, $admin)->id, 'password' => 'password',
        ])->assertOk();
        $this->assertSame(Role::Owner, $this->membership($org, $admin)->role);
        $this->assertSame(Role::Admin, $this->membership($org, $coOwner)->role);
    }
}
