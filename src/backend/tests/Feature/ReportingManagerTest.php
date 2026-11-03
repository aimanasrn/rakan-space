<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Support\ReportingLine;
use Tests\TestCase;

class ReportingManagerTest extends TestCase
{
    public function test_admin_sets_and_clears_a_reporting_manager(): void
    {
        $org = $this->createOrganization();
        $admin = $this->addMember($org, Role::Admin);
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $membership = $this->membership($org, $staff);

        $this->actingAs($admin)->putJson($this->api($org, "/members/{$membership->id}/manager"), ['manager_id' => $manager->id])
            ->assertOk()->assertJsonPath('data.manager.id', $manager->id);
        $this->assertSame($manager->id, ReportingLine::managerOf($org->id, $staff->id));
        $this->getJson($this->api($org, '/members?q='.urlencode($staff->name)))->assertJsonPath('data.0.manager.id', $manager->id);
        $this->assertDatabaseHas('activities', ['event' => 'member.manager_changed', 'organization_id' => $org->id]);

        $this->putJson($this->api($org, "/members/{$membership->id}/manager"), ['manager_id' => null])
            ->assertOk()->assertJsonPath('data.manager', null);
    }

    public function test_invalid_managers_are_rejected(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $a = $this->addMember($org);
        $b = $this->addMember($org);
        $outsider = $this->owner($this->createOrganization(null, 'Other'));
        $this->actingAs($owner);

        $ma = $this->membership($org, $a);
        $mb = $this->membership($org, $b);

        $this->putJson($this->api($org, "/members/{$ma->id}/manager"), ['manager_id' => $a->id])->assertJsonValidationErrors('manager_id');
        $this->putJson($this->api($org, "/members/{$ma->id}/manager"), ['manager_id' => $outsider->id])->assertJsonValidationErrors('manager_id');
        $this->putJson($this->api($org, "/members/{$ma->id}/manager"), ['manager_id' => 999999])->assertJsonValidationErrors('manager_id');

        // a -> b, then b -> a would be a loop.
        $this->putJson($this->api($org, "/members/{$ma->id}/manager"), ['manager_id' => $b->id])->assertOk();
        $this->putJson($this->api($org, "/members/{$mb->id}/manager"), ['manager_id' => $a->id])->assertJsonValidationErrors('manager_id');
    }

    public function test_only_admins_can_set_managers_and_other_organisations_get_404(): void
    {
        $org = $this->createOrganization(null, 'Alpha');
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $membership = $this->membership($org, $staff);

        $this->actingAs($manager)->putJson($this->api($org, "/members/{$membership->id}/manager"), ['manager_id' => $manager->id])->assertForbidden();

        $orgB = $this->createOrganization(null, 'Beta');
        $this->actingAs($this->owner($orgB))->putJson($this->api($orgB, "/members/{$membership->id}/manager"), ['manager_id' => null])->assertNotFound();
    }

    public function test_inactive_managers_are_ignored_and_removal_clears_reports_in_that_organisation_only(): void
    {
        $orgA = $this->createOrganization(null, 'Alpha');
        $orgB = $this->createOrganization(null, 'Beta');
        $boss = $this->addMember($orgA, Role::Manager);
        $this->addMember($orgB, Role::Manager, $boss);
        $staff = $this->addMember($orgA);
        $this->addMember($orgB, Role::Staff, $staff);
        $this->membership($orgA, $staff)->update(['manager_id' => $boss->id]);
        $this->membership($orgB, $staff)->update(['manager_id' => $boss->id]);

        $this->membership($orgA, $boss)->update(['status' => 'deactivated']);
        $this->assertNull(ReportingLine::managerOf($orgA->id, $staff->id));
        $this->membership($orgA, $boss)->update(['status' => 'active']);

        $this->actingAs($this->owner($orgA))->deleteJson($this->api($orgA, '/members/'.$this->membership($orgA, $boss)->id))->assertOk();

        $this->assertNull($this->membership($orgA, $staff)->fresh()->manager_id);
        $this->assertSame($boss->id, $this->membership($orgB, $staff)->fresh()->manager_id);
    }
}
