<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Events\ApprovalRequestStatusChanged;
use App\Models\Approval\ApprovalDelegation;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Organization;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\Approvals\Approvals;
use Illuminate\Support\Facades\Event;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

class ApprovalEngineTest extends TestCase
{
    /** @param list<array<string, mixed>> $steps */
    private function workflow(Organization $org, array $steps): ApprovalWorkflow
    {
        $workflow = ApprovalWorkflow::create(['organization_id' => $org->id, 'name' => 'Test flow']);
        foreach ($steps as $i => $step) {
            $workflow->steps()->create([
                'organization_id' => $org->id, 'position' => $i + 1, 'name' => $step['name'] ?? 'Step '.($i + 1),
                'mode' => $step['mode'] ?? 'any', 'approvers' => $step['approvers'], 'condition' => $step['condition'] ?? null,
                'sla_hours' => $step['sla_hours'] ?? null, 'escalate_to' => $step['escalate_to'] ?? null,
            ]);
        }

        return $workflow;
    }

    private function submit(Organization $org, User $requester, ApprovalWorkflow $workflow, array $data = []): ApprovalRequest
    {
        return Approvals::submitForApproval($org, $requester, 'manual', null, $workflow, 'Buy laptops', $data);
    }

    private function pendingApprovers(ApprovalRequest $request): array
    {
        $step = Approvals::currentStep($request->fresh());

        return $step ? $step->assignees()->whereNull('decision')->pluck('user_id')->sort()->values()->all() : [];
    }

    public function test_sequential_steps_with_manager_and_conditional_finance_step(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $finance = $this->addMember($org);
        $staff = $this->addMember($org);
        $this->membership($org, $staff)->update(['manager_id' => $manager->id]);

        $workflow = $this->workflow($org, [
            ['name' => 'Manager', 'approvers' => [['type' => 'manager']]],
            ['name' => 'Finance', 'approvers' => [['type' => 'user', 'user_id' => $finance->id]], 'condition' => ['field' => 'amount', 'operator' => 'gt', 'value' => 5000]],
        ]);

        // Small amount: finance step is skipped.
        $small = $this->submit($org, $staff, $workflow, ['amount' => 1200]);
        $this->assertSame([$manager->id], $this->pendingApprovers($small));
        $small = Approvals::decide($small, $manager, 'approve');
        $this->assertSame('approved', $small->status);
        $this->assertSame(['submitted', 'step_started', 'approved', 'skipped', 'completed'], $small->actions()->pluck('action')->all());

        // Large amount: finance must approve too.
        $large = $this->submit($org, $staff, $workflow, ['amount' => 9000]);
        $large = Approvals::decide($large, $manager, 'approve');
        $this->assertSame('pending', $large->status);
        $this->assertSame([$finance->id], $this->pendingApprovers($large));
        $this->assertSame('approved', Approvals::decide($large, $finance, 'approve')->status);
        // One "approved" notification per request; approvers were notified when each step started.
        $this->assertSame(2, UserNotification::where('user_id', $staff->id)->where('type', 'approval.approved')->count());
        $this->assertSame(1, UserNotification::where('user_id', $finance->id)->where('type', 'approval.requested')->count());
    }

    public function test_all_mode_needs_every_approver_and_any_mode_needs_one(): void
    {
        $org = $this->createOrganization();
        [$a, $b, $requester] = [$this->addMember($org), $this->addMember($org), $this->addMember($org)];

        $all = $this->workflow($org, [['mode' => 'all', 'approvers' => [['type' => 'user', 'user_id' => $a->id], ['type' => 'user', 'user_id' => $b->id]]]]);
        $request = $this->submit($org, $requester, $all);
        $this->assertSame('pending', Approvals::decide($request, $a, 'approve')->status);
        $this->assertSame('approved', Approvals::decide($request, $b, 'approve')->status);

        $any = $this->workflow($org, [['mode' => 'any', 'approvers' => [['type' => 'user', 'user_id' => $a->id], ['type' => 'user', 'user_id' => $b->id]]]]);
        $request = $this->submit($org, $requester, $any);
        $this->assertSame('approved', Approvals::decide($request, $b, 'approve')->status);
    }

    public function test_requester_never_approves_their_own_request_and_empty_steps_fall_back_to_admins(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $manager = $this->addMember($org, Role::Manager);

        // Role approver: the requester (a manager) is excluded; nobody else → Owner/Admin fallback.
        $workflow = $this->workflow($org, [['approvers' => [['type' => 'role', 'role' => 'manager']]]]);
        $request = $this->submit($org, $manager, $workflow);
        $this->assertSame([$owner->id], $this->pendingApprovers($request));

        $this->expectException(HttpException::class);
        Approvals::decide($request, $manager, 'approve');
    }

    public function test_reject_and_return_require_a_comment_and_return_starts_a_new_round(): void
    {
        Event::fake([ApprovalRequestStatusChanged::class]);
        $org = $this->createOrganization();
        $approver = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $workflow = $this->workflow($org, [['approvers' => [['type' => 'user', 'user_id' => $approver->id]]]]);
        $request = $this->submit($org, $staff, $workflow, ['amount' => 10]);

        try {
            Approvals::decide($request, $approver, 'return');
            $this->fail('A comment should be required.');
        } catch (ValidationException $e) {
            $this->assertArrayHasKey('comment', $e->errors());
        }

        $request = Approvals::decide($request, $approver, 'return', 'Please attach the quotation.');
        $this->assertSame('returned', $request->status);
        Event::assertDispatched(ApprovalRequestStatusChanged::class, fn ($e) => $e->status === 'returned');

        // Only the requester can resubmit.
        try {
            Approvals::resubmit($request, $approver);
            $this->fail('Only the requester can resubmit.');
        } catch (HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $request = Approvals::resubmit($request, $staff, ['amount' => 20]);
        $this->assertSame(['pending', 2], [$request->status, $request->round]);
        $this->assertSame([$approver->id], $this->pendingApprovers($request));

        $request = Approvals::decide($request, $approver, 'reject', 'Over budget.');
        $this->assertSame('rejected', $request->status);
        $this->assertNotNull($request->completed_at);
        $this->expectException(HttpException::class);
        Approvals::decide($request, $approver, 'approve');
    }

    public function test_delegation_routes_new_steps_to_the_delegate(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $deputy = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        ApprovalDelegation::create(['organization_id' => $org->id, 'delegator_id' => $manager->id, 'delegate_id' => $deputy->id,
            'starts_at' => now()->subHour(), 'ends_at' => now()->addDay()]);

        $workflow = $this->workflow($org, [['approvers' => [['type' => 'user', 'user_id' => $manager->id]]]]);
        $request = $this->submit($org, $staff, $workflow);

        $this->assertSame([$deputy->id], $this->pendingApprovers($request));
        $row = Approvals::currentStep($request)->assignees()->first();
        $this->assertSame($manager->id, $row->delegated_from);

        // Expired or revoked delegations no longer apply.
        ApprovalDelegation::query()->update(['revoked_at' => now()]);
        $this->assertSame([$manager->id], $this->pendingApprovers($this->submit($org, $staff, $workflow)));
    }

    public function test_sla_reminds_once_and_escalates_at_twice_the_limit(): void
    {
        $org = $this->createOrganization();
        $approver = $this->addMember($org, Role::Manager);
        $boss = $this->addMember($org, Role::Admin);
        $staff = $this->addMember($org);
        $workflow = $this->workflow($org, [['approvers' => [['type' => 'user', 'user_id' => $approver->id]], 'sla_hours' => 24, 'escalate_to' => $boss->id]]);
        $request = $this->submit($org, $staff, $workflow);

        $this->travel(23)->hours();
        $this->assertSame(['reminded' => 0, 'escalated' => 0], Approvals::processSla());

        $this->travel(2)->hours();
        $this->assertSame(['reminded' => 1, 'escalated' => 0], Approvals::processSla());
        $this->assertSame(['reminded' => 0, 'escalated' => 0], Approvals::processSla());
        $this->assertSame(1, UserNotification::where('user_id', $approver->id)->where('type', 'approval.reminder')->count());

        $this->travel(24)->hours();
        $this->assertSame(['reminded' => 0, 'escalated' => 1], Approvals::processSla());
        $this->assertSame(['reminded' => 0, 'escalated' => 0], Approvals::processSla());
        $this->assertSame([$approver->id, $boss->id], $this->pendingApprovers($request));

        // The escalation approver can now decide.
        $this->assertSame('approved', Approvals::decide($request, $boss, 'approve')->status);
    }

    public function test_cancel_by_requester_only(): void
    {
        $org = $this->createOrganization();
        $approver = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $request = $this->submit($org, $staff, $this->workflow($org, [['approvers' => [['type' => 'user', 'user_id' => $approver->id]]]]));

        try {
            Approvals::cancel($request, $approver);
            $this->fail('Approvers cannot withdraw requests.');
        } catch (HttpException $e) {
            $this->assertSame(403, $e->getStatusCode());
        }

        $this->assertSame('cancelled', Approvals::cancel($request, $staff)->status);
        $this->assertSame([], $this->pendingApprovers($request));
    }

    public function test_removing_the_only_approver_hands_the_step_to_admins(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $approver = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $request = $this->submit($org, $staff, $this->workflow($org, [['approvers' => [['type' => 'user', 'user_id' => $approver->id]]]]));

        $this->actingAs($owner)->deleteJson($this->api($org, '/members/'.$this->membership($org, $approver)->id))->assertOk();

        $this->assertSame([$owner->id], $this->pendingApprovers($request));
        $this->assertTrue($request->actions()->where('action', 'approver_removed')->exists());
    }

    public function test_workflow_without_steps_or_from_another_organisation_is_refused(): void
    {
        $org = $this->createOrganization(null, 'Alpha');
        $other = $this->createOrganization(null, 'Beta');
        $staff = $this->addMember($org);

        try {
            $this->submit($org, $staff, $this->workflow($org, []));
            $this->fail('A workflow needs steps.');
        } catch (ValidationException) {
            $this->addToAssertionCount(1);
        }

        $foreign = $this->workflow($other, [['approvers' => [['type' => 'manager']]]]);
        $this->expectException(HttpException::class);
        $this->submit($org, $staff, $foreign);
    }
}
