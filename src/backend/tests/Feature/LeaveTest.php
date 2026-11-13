<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\Approval\ApprovalRequest;
use App\Models\Leave\LeaveRequest;
use App\Models\Organization;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\AppCatalog;
use Tests\TestCase;

class LeaveTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        // Wednesday 11 Nov 2026, 10:00 in Kuala Lumpur.
        $this->travelTo(now()->setTimezone('Asia/Kuala_Lumpur')->setDate(2026, 11, 11)->setTime(10, 0));
    }

    /** @return array{0: Organization, 1: User, 2: User, 3: User} [org, staff, their manager, colleague] */
    private function team(string $name = 'Acme'): array
    {
        $org = $this->createOrganization(null, $name);
        AppCatalog::installDefaults($org, $this->owner($org));
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org, Role::Staff);
        $colleague = $this->addMember($org, Role::Staff);
        $this->membership($org, $staff)->update(['manager_id' => $manager->id]);

        return [$org, $staff, $manager, $colleague];
    }

    /** @return array<string, int> leave type key => id */
    private function types(Organization $org, User $user): array
    {
        return collect($this->actingAs($user)->getJson($this->api($org, '/leave/types'))->assertOk()->json('data'))
            ->pluck('id', 'key')->all();
    }

    private function balance(Organization $org, User $user, string $key, array $query = []): array
    {
        $types = $this->actingAs($user)->getJson($this->api($org, '/leave/summary?'.http_build_query($query)))->assertOk()->json('data.types');

        return collect($types)->firstWhere('key', $key);
    }

    private function apply(Organization $org, User $user, array $data)
    {
        return $this->actingAs($user)->postJson($this->api($org, '/leave/requests'), $data);
    }

    private function decide(Organization $org, User $approver, int $leaveId, string $decision, ?string $comment = null): void
    {
        $requestId = LeaveRequest::findOrFail($leaveId)->approval_request_id;
        $this->actingAs($approver)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => $decision, 'comment' => $comment])->assertOk();
    }

    public function test_member_applies_and_their_manager_approves(): void
    {
        [$org, $staff, $manager] = $this->team();
        $t = $this->types($org, $staff);
        $this->assertSame(['annual', 'medical', 'paternity', 'business_travel', 'calamity', 'off_in_lieu', 'compassionate', 'marriage', 'training', 'unpaid', 'hospitalization'], array_keys($t));
        $this->assertEquals(['eligible' => 14.0, 'taken' => 0.0, 'pending' => 0.0, 'balance' => 14.0],
            array_intersect_key($this->balance($org, $staff, 'annual'), array_flip(['eligible', 'taken', 'pending', 'balance'])));
        // No limit for business travel.
        $this->assertNull($this->balance($org, $staff, 'business_travel')['balance']);

        // Monday to Friday = 5 working days.
        $id = $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-20', 'reason' => 'Family trip'])
            ->assertCreated()
            ->assertJsonPath('data.days', 5)
            ->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval.current_step', 'Reporting manager')
            ->assertJsonPath('data.permissions.cancel', true)
            ->json('data.id');
        $this->assertEquals(5.0, $this->balance($org, $staff, 'annual')['pending']);

        $this->decide($org, $manager, $id, 'approve', 'Enjoy!');
        $this->actingAs($staff)->getJson($this->api($org, "/leave/requests/{$id}"))->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.approval.comment', 'Enjoy!');
        $annual = $this->balance($org, $staff, 'annual');
        $this->assertEquals([5.0, 0.0, 9.0], [$annual['taken'], $annual['pending'], $annual['balance']]);

        // Weekends are not counted: Friday to Monday = 2 days.
        $this->apply($org, $staff, ['leave_type_id' => $t['medical'], 'start_date' => '2026-11-27', 'end_date' => '2026-11-30'])
            ->assertCreated()->assertJsonPath('data.days', 2);
        // A half day, and the other half of the same day.
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-25', 'end_date' => '2026-11-25', 'half_day' => 'am'])
            ->assertCreated()->assertJsonPath('data.days', 0.5);
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-25', 'end_date' => '2026-11-25', 'half_day' => 'pm'])
            ->assertCreated();

        // Rules.
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-18', 'end_date' => '2026-11-19'])
            ->assertJsonValidationErrors('start_date'); // overlaps approved leave
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-14', 'end_date' => '2026-11-15'])
            ->assertJsonValidationErrors('start_date'); // weekend only
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-01', 'end_date' => '2026-12-31'])
            ->assertJsonValidationErrors('leave_type_id'); // 23 days, 8 left
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-30', 'end_date' => '2027-01-04'])
            ->assertJsonValidationErrors('end_date'); // two years
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-01', 'end_date' => '2026-12-02', 'half_day' => 'am'])
            ->assertJsonValidationErrors('half_day');
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-02', 'end_date' => '2026-12-01'])
            ->assertJsonValidationErrors('end_date');

        // Off-in-lieu starts at 0 and is granted by an admin.
        $this->apply($org, $staff, ['leave_type_id' => $t['off_in_lieu'], 'start_date' => '2026-12-07', 'end_date' => '2026-12-07'])
            ->assertJsonValidationErrors('leave_type_id');
        $this->actingAs($this->owner($org))->putJson($this->api($org, '/leave/entitlements'), [
            'user_id' => $staff->id, 'year' => 2026, 'entitlements' => [['leave_type_id' => $t['off_in_lieu'], 'days' => 2]],
        ])->assertOk();
        $this->assertTrue($this->balance($org, $staff, 'off_in_lieu')['adjusted']);
        $this->apply($org, $staff, ['leave_type_id' => $t['off_in_lieu'], 'start_date' => '2026-12-07', 'end_date' => '2026-12-07'])->assertCreated();
        // Business travel has no limit.
        $this->apply($org, $staff, ['leave_type_id' => $t['business_travel'], 'start_date' => '2026-12-14', 'end_date' => '2026-12-24'])->assertCreated();

        // Admins change the default entitlement and turn types off.
        $owner = $this->owner($org);
        $this->actingAs($owner)->putJson($this->api($org, '/leave/settings'), ['types' => [
            ['id' => $t['annual'], 'entitlement_days' => 16, 'is_active' => true],
            ['id' => $t['marriage'], 'entitlement_days' => 3, 'is_active' => false],
        ]])->assertOk();
        $this->assertEquals(16.0, $this->balance($org, $staff, 'annual')['eligible']);
        $this->apply($org, $staff, ['leave_type_id' => $t['marriage'], 'start_date' => '2026-12-28', 'end_date' => '2026-12-28'])
            ->assertJsonValidationErrors('leave_type_id');
    }

    public function test_return_resubmit_reject_and_cancel(): void
    {
        [$org, $staff, $manager] = $this->team();
        $t = $this->types($org, $staff);

        $id = $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-17'])->json('data.id');
        $this->decide($org, $manager, $id, 'return', 'We have a release on the 16th');
        $this->actingAs($staff)->getJson($this->api($org, "/leave/requests/{$id}"))->assertOk()
            ->assertJsonPath('data.status', 'returned')
            ->assertJsonPath('data.permissions.edit', true)
            ->assertJsonPath('data.approval.decided_by', $manager->name);
        $this->actingAs($staff)->putJson($this->api($org, "/leave/requests/{$id}"), ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-17', 'end_date' => '2026-11-19'])
            ->assertOk()->assertJsonPath('data.status', 'pending_approval')->assertJsonPath('data.days', 3);
        // Only returned applications can be edited.
        $this->actingAs($staff)->putJson($this->api($org, "/leave/requests/{$id}"), ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-17', 'end_date' => '2026-11-17'])
            ->assertStatus(422);
        $this->decide($org, $manager, $id, 'reject', 'Busy month');
        $this->assertEquals(0.0, $this->balance($org, $staff, 'annual')['pending']);
        $this->actingAs($staff)->postJson($this->api($org, "/leave/requests/{$id}/cancel"))->assertStatus(422);

        // Withdrawing a pending application cancels its approval request.
        $pending = $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-23', 'end_date' => '2026-11-23'])->json('data.id');
        $this->actingAs($staff)->postJson($this->api($org, "/leave/requests/{$pending}/cancel"))->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame(ApprovalRequest::STATUS_CANCELLED, ApprovalRequest::find(LeaveRequest::find($pending)->approval_request_id)->status);
        // The dates are free again.
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-23', 'end_date' => '2026-11-23'])->assertCreated();

        // Approved leave can be cancelled before it starts; the manager is told.
        $future = $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-01', 'end_date' => '2026-12-01'])->json('data.id');
        $this->decide($org, $manager, $future, 'approve');
        $this->actingAs($staff)->postJson($this->api($org, "/leave/requests/{$future}/cancel"))->assertOk()->assertJsonPath('data.status', 'cancelled');
        $this->assertSame(1, UserNotification::where('user_id', $manager->id)->where('type', 'leave.cancelled')->count());

        // ...but not once it has started.
        $today = $this->apply($org, $staff, ['leave_type_id' => $t['medical'], 'start_date' => '2026-11-11', 'end_date' => '2026-11-11'])->json('data.id');
        $this->decide($org, $manager, $today, 'approve');
        $this->actingAs($staff)->getJson($this->api($org, "/leave/requests/{$today}"))->assertJsonPath('data.permissions.cancel', false);
        $this->actingAs($staff)->postJson($this->api($org, "/leave/requests/{$today}/cancel"))->assertStatus(422);
    }

    public function test_who_sees_applications_and_balances(): void
    {
        [$org, $staff, $manager, $colleague] = $this->team();
        $t = $this->types($org, $staff);
        $id = $this->apply($org, $staff, ['leave_type_id' => $t['medical'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-16', 'reason' => 'Clinic'])->json('data.id');
        $url = $this->api($org, "/leave/requests/{$id}");

        // The reporting manager sees it but cannot act for the applicant.
        $this->actingAs($manager)->getJson($url)->assertOk()->assertJsonPath('data.reason', 'Clinic')->assertJsonPath('data.permissions.cancel', false);
        $this->actingAs($manager)->postJson("{$url}/cancel")->assertForbidden();
        $this->actingAs($manager)->getJson($this->api($org, '/leave/requests?scope=team'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($manager)->getJson($this->api($org, "/leave/summary?user_id={$staff->id}"))->assertOk();
        $this->actingAs($manager)->getJson($this->api($org, '/leave/requests?scope=all'))->assertForbidden();

        // A colleague: 404 everywhere.
        $this->actingAs($colleague)->getJson($url)->assertNotFound();
        $this->actingAs($colleague)->postJson("{$url}/cancel")->assertNotFound();
        $this->actingAs($colleague)->putJson($url, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-16'])->assertNotFound();
        $this->actingAs($colleague)->getJson($this->api($org, '/leave/requests?scope=team'))->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($colleague)->getJson($this->api($org, "/leave/summary?user_id={$staff->id}"))->assertNotFound();

        // Leave admins (Owner) see everything; only they change settings and entitlements.
        $owner = $this->owner($org);
        $this->actingAs($owner)->getJson($url)->assertOk();
        $this->actingAs($owner)->getJson($this->api($org, '/leave/requests?scope=all'))->assertOk()->assertJsonCount(1, 'data');
        $this->actingAs($manager)->getJson($this->api($org, '/leave/settings'))->assertForbidden();
        $this->actingAs($manager)->putJson($this->api($org, '/leave/entitlements'), [
            'user_id' => $staff->id, 'year' => 2026, 'entitlements' => [['leave_type_id' => $t['annual'], 'days' => 30]],
        ])->assertForbidden();

        // Another organisation: guessed IDs are 404 or rejected.
        [$other, $theirStaff] = $this->team('Other Co');
        $theirTypes = $this->types($other, $theirStaff);
        $theirs = $this->apply($other, $theirStaff, ['leave_type_id' => $theirTypes['annual'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-16'])->json('data.id');
        $this->actingAs($owner)->getJson($this->api($org, "/leave/requests/{$theirs}"))->assertNotFound();
        $this->actingAs($owner)->postJson($this->api($org, "/leave/requests/{$theirs}/cancel"))->assertNotFound();
        $this->actingAs($owner)->getJson($this->api($other, "/leave/requests/{$theirs}"))->assertNotFound();
        $this->actingAs($owner)->getJson($this->api($org, "/leave/summary?user_id={$theirStaff->id}"))->assertNotFound();
        $this->apply($org, $staff, ['leave_type_id' => $theirTypes['annual'], 'start_date' => '2026-12-01', 'end_date' => '2026-12-01'])
            ->assertJsonValidationErrors('leave_type_id');
        $this->actingAs($owner)->putJson($this->api($org, '/leave/entitlements'), [
            'user_id' => $theirStaff->id, 'year' => 2026, 'entitlements' => [['leave_type_id' => $t['annual'], 'days' => 30]],
        ])->assertJsonValidationErrors('user_id');
        $this->actingAs($owner)->putJson($this->api($org, '/leave/entitlements'), [
            'user_id' => $staff->id, 'year' => 2026, 'entitlements' => [['leave_type_id' => $theirTypes['annual'], 'days' => 30]],
        ])->assertJsonValidationErrors('entitlements.0.leave_type_id');
        $this->actingAs($owner)->putJson($this->api($org, '/leave/settings'), ['types' => [['id' => $theirTypes['annual'], 'entitlement_days' => 99, 'is_active' => true]]])
            ->assertJsonValidationErrors('types.0.id');
        $this->assertEquals(14.0, $this->balance($other, $theirStaff, 'annual')['eligible']);
    }

    public function test_calendar_shows_who_is_away_without_private_details(): void
    {
        [$org, $staff, $manager, $colleague] = $this->team();
        $t = $this->types($org, $staff);
        $approved = $this->apply($org, $staff, ['leave_type_id' => $t['medical'], 'start_date' => '2026-11-16', 'end_date' => '2026-11-17'])->json('data.id');
        $this->decide($org, $manager, $approved, 'approve');
        $this->apply($org, $staff, ['leave_type_id' => $t['annual'], 'start_date' => '2026-11-24', 'end_date' => '2026-11-24']); // pending
        $this->apply($org, $colleague, ['leave_type_id' => $t['annual'], 'start_date' => '2026-12-01', 'end_date' => '2026-12-01']); // next month

        // A colleague sees that the person is away, not why, and not pending applications.
        $entries = $this->actingAs($colleague)->getJson($this->api($org, '/leave/calendar?month=2026-11'))->assertOk()->json('data.entries');
        $this->assertCount(1, $entries);
        $this->assertSame($staff->id, $entries[0]['user']['id']);
        $this->assertNull($entries[0]['type']);
        $this->assertFalse($entries[0]['can_view']);

        // The manager sees the type and the pending application too.
        $entries = $this->actingAs($manager)->getJson($this->api($org, '/leave/calendar?month=2026-11'))->assertOk()->json('data.entries');
        $this->assertSame(['approved', 'pending_approval'], array_column($entries, 'status'));
        $this->assertSame('Medical Leave', $entries[0]['type']['name']);
        $this->actingAs($manager)->getJson($this->api($org, '/leave/calendar?month=2026-11&scope=mine'))->assertOk()->assertJsonCount(0, 'data.entries');
        $this->actingAs($manager)->getJson($this->api($org, '/leave/calendar?month=2026-11&scope=team'))->assertOk()->assertJsonCount(2, 'data.entries');

        // Another organisation's calendar never shows these.
        [$other, $theirStaff] = $this->team('Other Co');
        $this->actingAs($theirStaff)->getJson($this->api($other, '/leave/calendar?month=2026-11'))->assertOk()->assertJsonCount(0, 'data.entries');

        // A removed member drops off the calendar but keeps their history.
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/members/'.$this->membership($org, $staff)->id))->assertSuccessful();
        $this->actingAs($colleague)->getJson($this->api($org, '/leave/calendar?month=2026-11'))->assertOk()->assertJsonCount(0, 'data.entries');
        $this->assertSame(2, LeaveRequest::where('user_id', $staff->id)->count());
        $this->actingAs($this->owner($org))->getJson($this->api($org, "/leave/requests/{$approved}"))->assertOk();
    }

    public function test_app_must_be_installed(): void
    {
        [$org, $staff] = $this->team();
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/admin/apps/leave'))->assertSuccessful();
        $this->actingAs($staff)->getJson($this->api($org, '/leave/summary'))->assertNotFound();
        $this->actingAs($staff)->getJson($this->api($org, '/leave/calendar'))->assertNotFound();
    }
}
