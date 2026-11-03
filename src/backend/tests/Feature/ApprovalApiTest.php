<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Approval\ApprovalWorkflow;
use App\Support\AppCatalog;
use Tests\TestCase;

class ApprovalApiTest extends TestCase
{
    private function setUpOrg(string $name = 'Acme'): array
    {
        $org = $this->createOrganization(null, $name);
        AppCatalog::installDefaults($org, $this->owner($org));
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $other = $this->addMember($org);
        $this->membership($org, $staff)->update(['manager_id' => $manager->id]);

        return [$org, $this->owner($org), $manager, $staff, $other];
    }

    private function workflowPayload(array $overrides = []): array
    {
        return [
            'name' => 'Purchase approval',
            'steps' => [
                ['name' => 'Manager', 'mode' => 'any', 'approvers' => [['type' => 'manager']]],
                ['name' => 'Finance', 'mode' => 'any', 'approvers' => [['type' => 'role', 'role' => 'admin'], ['type' => 'role', 'role' => 'owner']],
                    'condition' => ['field' => 'amount', 'operator' => 'gt', 'value' => 5000], 'sla_hours' => 48],
            ],
            ...$overrides,
        ];
    }

    public function test_main_flow_through_the_api(): void
    {
        [$org, $owner, $manager, $staff] = $this->setUpOrg();

        $workflowId = $this->actingAs($owner)->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())
            ->assertCreated()->assertJsonPath('data.steps.1.condition.operator', 'gt')->json('data.id');

        $id = $this->actingAs($staff)->postJson($this->api($org, '/approval/requests'), [
            'workflow_id' => $workflowId, 'title' => 'New laptops', 'details' => '3 units', 'amount' => 9000,
        ])->assertCreated()->assertJsonPath('data.status', 'pending')->json('data.id');

        $this->getJson($this->api($org, '/approval/requests?box=mine'))->assertJsonPath('data.0.id', $id);
        $this->actingAs($manager)->getJson($this->api($org, '/approval/requests?box=inbox'))
            ->assertJsonPath('data.0.id', $id)->assertJsonPath('data.0.my_turn', true);
        $this->getJson($this->api($org, '/approval/summary'))->assertJsonPath('data.inbox', 1);

        $this->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'reject'])->assertJsonValidationErrors('comment');
        $this->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve', 'comment' => 'OK'])
            ->assertOk()->assertJsonPath('data.status', 'pending')->assertJsonPath('data.current_step.name', 'Finance');
        // The manager has acted; it is no longer their turn.
        $this->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])->assertForbidden();

        $this->actingAs($owner)->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])
            ->assertOk()->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.history.0.action', 'submitted');
    }

    public function test_return_then_resubmit_and_withdraw(): void
    {
        [$org, $owner, $manager, $staff] = $this->setUpOrg();
        $workflowId = $this->actingAs($owner)->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->json('data.id');
        $id = $this->actingAs($staff)->postJson($this->api($org, '/approval/requests'), ['workflow_id' => $workflowId, 'title' => 'Training budget', 'amount' => 100])->json('data.id');

        $this->actingAs($manager)->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'return', 'comment' => 'Add the course link'])
            ->assertJsonPath('data.status', 'returned');

        $this->actingAs($staff)->getJson($this->api($org, "/approval/requests/{$id}"))->assertJsonPath('data.permissions.resubmit', true);
        $this->postJson($this->api($org, "/approval/requests/{$id}/resubmit"), ['title' => 'Training budget (with link)', 'amount' => 100])
            ->assertOk()->assertJsonPath('data.round', 2)->assertJsonPath('data.status', 'pending');
        $this->postJson($this->api($org, "/approval/requests/{$id}/cancel"))->assertOk()->assertJsonPath('data.status', 'cancelled');
    }

    public function test_non_participants_get_404_and_only_approval_admins_see_everything(): void
    {
        [$org, $owner, $manager, $staff, $other] = $this->setUpOrg();
        $workflowId = $this->actingAs($owner)->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->json('data.id');
        $id = $this->actingAs($staff)->postJson($this->api($org, '/approval/requests'), ['workflow_id' => $workflowId, 'title' => 'Private request'])->json('data.id');

        $this->actingAs($other)->getJson($this->api($org, "/approval/requests/{$id}"))->assertNotFound();
        $this->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])->assertNotFound();
        $this->assertSame([], $this->getJson($this->api($org, '/approval/requests?box=mine'))->json('data'));
        $this->getJson($this->api($org, '/approval/requests?box=all'))->assertForbidden();
        $this->getJson($this->api($org, '/approval/workflows'))->assertForbidden();
        $this->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->assertForbidden();

        // Owners have the Approval "admin" ability by default.
        $this->actingAs($owner)->getJson($this->api($org, "/approval/requests/{$id}"))->assertOk();
        $this->getJson($this->api($org, '/approval/requests?box=all'))->assertJsonPath('meta.total', 1);
    }

    public function test_other_organisations_cannot_reach_requests_or_workflows_by_guessed_ids(): void
    {
        [$org, $owner, , $staff] = $this->setUpOrg('Alpha');
        $workflowId = $this->actingAs($owner)->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->json('data.id');
        $id = $this->actingAs($staff)->postJson($this->api($org, '/approval/requests'), ['workflow_id' => $workflowId, 'title' => 'Alpha secret'])->json('data.id');

        [$orgB, $ownerB] = $this->setUpOrg('Beta');
        $this->actingAs($ownerB);
        $this->getJson($this->api($orgB, "/approval/requests/{$id}"))->assertNotFound();
        $this->postJson($this->api($orgB, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])->assertNotFound();
        $this->getJson($this->api($orgB, "/approval/workflows/{$workflowId}"))->assertNotFound();
        $this->putJson($this->api($orgB, "/approval/workflows/{$workflowId}"), $this->workflowPayload())->assertNotFound();
        // A request cannot use another organisation's workflow.
        $this->postJson($this->api($orgB, '/approval/requests'), ['workflow_id' => $workflowId, 'title' => 'Sneaky'])->assertUnprocessable();
        $this->getJson($this->api($org, '/approval/requests'))->assertNotFound();
    }

    public function test_workflow_validation_rejects_people_outside_the_workspace(): void
    {
        [$org, $owner] = $this->setUpOrg('Alpha');
        $outsider = $this->owner($this->createOrganization(null, 'Beta'));
        $this->actingAs($owner);

        $bad = $this->workflowPayload(['steps' => [['name' => 'X', 'mode' => 'any', 'approvers' => [['type' => 'user', 'user_id' => $outsider->id]]]]]);
        $this->postJson($this->api($org, '/approval/workflows'), $bad)->assertJsonValidationErrors('steps.0.approvers');
        $this->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload(['steps' => []]))->assertJsonValidationErrors('steps');
        $escalation = $this->workflowPayload(['steps' => [['name' => 'X', 'mode' => 'all', 'approvers' => [['type' => 'manager']], 'escalate_to' => $owner->id]]]);
        $this->postJson($this->api($org, '/approval/workflows'), $escalation)->assertJsonValidationErrors('steps.0.sla_hours');

        // Used workflows cannot be deleted, only turned off.
        $id = $this->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->json('data.id');
        $this->actingAs($this->addMember($org))->postJson($this->api($org, '/approval/requests'), ['workflow_id' => $id, 'title' => 'Used once']);
        $this->actingAs($owner)->deleteJson($this->api($org, "/approval/workflows/{$id}"))->assertUnprocessable();
        $this->putJson($this->api($org, "/approval/workflows/{$id}"), $this->workflowPayload(['is_active' => false]))->assertJsonPath('data.is_active', false);
        $this->assertFalse(ApprovalWorkflow::find($id)->is_active);
    }

    public function test_delegation_endpoints_hand_over_waiting_approvals(): void
    {
        [$org, $owner, $manager, $staff, $other] = $this->setUpOrg();
        $deputy = $this->addMember($org, Role::Manager);
        $outsider = $this->owner($this->createOrganization(null, 'Elsewhere'));
        $workflowId = $this->actingAs($owner)->postJson($this->api($org, '/approval/workflows'), $this->workflowPayload())->json('data.id');
        $id = $this->actingAs($staff)->postJson($this->api($org, '/approval/requests'), ['workflow_id' => $workflowId, 'title' => 'Waiting'])->json('data.id');

        $this->actingAs($manager);
        $window = ['starts_at' => now()->subMinute()->toIso8601String(), 'ends_at' => now()->addWeek()->toIso8601String()];
        $this->postJson($this->api($org, '/approval/delegations'), ['delegate_id' => $manager->id, ...$window])->assertJsonValidationErrors('delegate_id');
        $this->postJson($this->api($org, '/approval/delegations'), ['delegate_id' => $outsider->id, ...$window])->assertJsonValidationErrors('delegate_id');
        $delegationId = $this->postJson($this->api($org, '/approval/delegations'), ['delegate_id' => $deputy->id, 'reason' => 'Leave', ...$window])
            ->assertCreated()->assertJsonPath('data.status', 'active')->json('data.id');
        $this->postJson($this->api($org, '/approval/delegations'), ['delegate_id' => $deputy->id, ...$window])->assertJsonValidationErrors('starts_at');

        // The waiting request moved to the deputy.
        $this->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])->assertForbidden();
        $this->getJson($this->api($org, "/approval/requests/{$id}"))->assertOk();
        $this->actingAs($deputy)->postJson($this->api($org, "/approval/requests/{$id}/decide"), ['decision' => 'approve'])->assertOk();

        // Someone else's delegation cannot be revoked (or seen).
        $this->actingAs($other)->deleteJson($this->api($org, "/approval/delegations/{$delegationId}"))->assertNotFound();
        $this->actingAs($manager)->deleteJson($this->api($org, "/approval/delegations/{$delegationId}"))->assertOk()->assertJsonPath('data.status', 'revoked');
    }
}
