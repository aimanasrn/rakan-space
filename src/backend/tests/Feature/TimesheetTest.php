<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\AppRolePermission;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Timesheet\Timesheet;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\AppCatalog;
use Illuminate\Support\Facades\Artisan;
use Tests\TestCase;

class TimesheetTest extends TestCase
{
    private const WEEK = '2026-11-02';

    private const LAST_WEEK = '2026-10-26';

    protected function setUp(): void
    {
        parent::setUp();
        // Friday 6 Nov 2026, 10:00 in Kuala Lumpur.
        $this->travelTo(now()->setTimezone('Asia/Kuala_Lumpur')->setDate(2026, 11, 6)->setTime(10, 0));
    }

    private function org(string $name = 'Acme'): Organization
    {
        $org = $this->createOrganization(null, $name);
        AppCatalog::installDefaults($org, $this->owner($org));

        return $org;
    }

    private function reportsTo(Organization $org, User $user, User $manager): void
    {
        $this->membership($org, $user)->update(['manager_id' => $manager->id]);
    }

    private function week(Organization $org, string $week = self::WEEK): string
    {
        return $this->api($org, '/timesheet/weeks/'.$week);
    }

    private function entry(?int $projectId, string $date, int $minutes, ?int $taskId = null, ?string $note = null): array
    {
        return ['project_id' => $projectId, 'task_id' => $taskId, 'work_date' => $date, 'minutes' => $minutes, 'note' => $note];
    }

    /** @return array{0: Organization, 1: User, 2: User, 3: Project} [org, staff, manager, project] */
    private function team(): array
    {
        $org = $this->org();
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org, Role::Staff);
        $this->reportsTo($org, $staff, $manager);
        $project = $this->createProject($org, $manager, [$staff]);

        return [$org, $staff, $manager, $project];
    }

    public function test_member_logs_a_week_and_their_manager_approves_it(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $task = $this->createTask($project, $staff);

        $this->actingAs($staff)->getJson($this->week($org, '2026-11-04'))->assertOk()
            ->assertJsonPath('data.id', null)
            ->assertJsonPath('data.week_start', self::WEEK)
            ->assertJsonPath('data.week_end', '2026-11-08')
            ->assertJsonPath('data.permissions.edit', true);

        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [
            $this->entry($project->id, '2026-11-02', 240, $task->id, 'Wireframes'),
            $this->entry($project->id, '2026-11-03', 480, $task->id),
            $this->entry(null, '2026-11-03', 60, null, 'Training'),
            $this->entry($project->id, '2026-11-04', 0), // empty cells are ignored
        ]])->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.total_minutes', 780)
            ->assertJsonCount(3, 'data.entries')
            ->assertJsonPath('data.entries.0.project_name', $project->name)
            ->assertJsonPath('data.entries.0.task_title', $task->title)
            ->assertJsonPath('data.permissions.submit', true);

        $res = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()
            ->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval.current_step', 'Reporting manager');
        $sheetId = $res->json('data.id');
        $requestId = $res->json('data.approval.id');

        // A default workflow was created and remembered.
        $this->assertSame(1, ApprovalWorkflow::where('organization_id', $org->id)->where('name', 'Timesheet approval')->count());
        $request = ApprovalRequest::findOrFail($requestId);
        $this->assertSame('timesheet', $request->entity_type);
        $this->assertSame(13.0, (float) $request->data['hours']);
        $this->assertStringContainsString($project->name.' 12 h', $request->summary);
        $this->assertSame('/apps/timesheet/sheets/'.$sheetId, $request->link);

        // Locked while waiting.
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => []])->assertStatus(422);

        // The manager sees it in their team list and opens it.
        $this->actingAs($manager)->getJson($this->api($org, '/timesheet/sheets?scope=team'))->assertOk()
            ->assertJsonPath('data.0.id', $sheetId)->assertJsonPath('data.0.user.id', $staff->id);
        $this->actingAs($manager)->getJson($this->api($org, "/timesheet/sheets/{$sheetId}"))->assertOk()
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.approval.can_view', true);

        $this->actingAs($manager)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'approve'])->assertOk();

        $this->actingAs($staff)->getJson($this->week($org))->assertOk()
            ->assertJsonPath('data.status', 'approved')
            ->assertJsonPath('data.permissions.edit', false)
            ->assertJsonPath('data.permissions.withdraw', false);
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => []])->assertStatus(422);
    }

    public function test_returned_week_is_edited_and_resubmitted_and_rejected_week_reopens_as_draft(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 300)]])->assertOk();
        $requestId = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()->json('data.approval.id');

        $this->actingAs($manager)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'return', 'comment' => 'Split Monday by task'])->assertOk();
        $this->actingAs($staff)->getJson($this->week($org))->assertOk()
            ->assertJsonPath('data.status', 'returned')
            ->assertJsonPath('data.approval.comment', 'Split Monday by task')
            ->assertJsonPath('data.approval.decided_by', $manager->name)
            ->assertJsonPath('data.permissions.edit', true);

        // Editing keeps it "returned" until it is sent again; the same request continues.
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 420)]])
            ->assertOk()->assertJsonPath('data.status', 'returned');
        $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()
            ->assertJsonPath('data.status', 'pending_approval')
            ->assertJsonPath('data.approval.id', $requestId);
        $request = ApprovalRequest::findOrFail($requestId);
        $this->assertSame(2, $request->round);
        $this->assertSame(7.0, (float) $request->data['hours']);

        // Rejected: editing reopens the week as a draft, and the next submit is a new request.
        $this->actingAs($manager)->postJson($this->api($org, "/approval/requests/{$requestId}/decide"), ['decision' => 'reject', 'comment' => 'Wrong project'])->assertOk();
        $this->actingAs($staff)->getJson($this->week($org))->assertJsonPath('data.status', 'rejected')->assertJsonPath('data.permissions.submit', false);
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry(null, '2026-11-02', 420)]])
            ->assertOk()->assertJsonPath('data.status', 'draft')->assertJsonPath('data.approval', null);
        $newId = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()->json('data.approval.id');
        $this->assertNotSame($requestId, $newId);
    }

    public function test_withdrawing_turns_the_week_back_into_a_draft(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60)]])->assertOk();
        $res = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk();
        $sheetId = $res->json('data.id');

        // Only the owner can withdraw.
        $this->actingAs($manager)->postJson($this->api($org, "/timesheet/sheets/{$sheetId}/withdraw"))->assertForbidden();

        $this->actingAs($staff)->postJson($this->api($org, "/timesheet/sheets/{$sheetId}/withdraw"))->assertOk()
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.approval', null);
        $this->assertSame('cancelled', ApprovalRequest::findOrFail($res->json('data.approval.id'))->status);
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 90)]])->assertOk();
    }

    public function test_entries_are_validated(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $other = $this->createProject($org, $manager, []); // staff is not a member
        $otherTask = $this->createTask($other);
        $archived = $this->createProject($org, $manager, [$staff]);
        $archived->update(['archived_at' => now()]);
        $foreignOrg = $this->org('Other Co');
        $foreignProject = $this->createProject($foreignOrg, $this->owner($foreignOrg), [], 'organization');
        $this->actingAs($staff);

        // Future week, wrong day, too many hours, duplicate cell.
        $this->putJson($this->api($org, '/timesheet/weeks/2026-11-09'), ['entries' => []])->assertJsonValidationErrors('week');
        $this->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-09', 60)]])
            ->assertJsonValidationErrors('entries.0.work_date');
        $this->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 1000), $this->entry(null, '2026-11-02', 500)]])
            ->assertJsonValidationErrors('entries.1.minutes');
        $this->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60), $this->entry($project->id, '2026-11-02', 30)]])
            ->assertJsonValidationErrors('entries.1.work_date');
        $this->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 1441)]])
            ->assertJsonValidationErrors('entries.0.minutes');
        $this->putJson($this->week($org), ['entries' => [$this->entry(null, '2026-11-02', 60, $otherTask->id)]])
            ->assertJsonValidationErrors('entries.0.project_id');

        // Projects the member cannot log to, archived projects, other organisations and
        // guessed IDs all get the same answer.
        foreach ([$other->id, $archived->id, $foreignProject->id, 999999] as $id) {
            $res = $this->putJson($this->week($org), ['entries' => [$this->entry($id, '2026-11-02', 60)]])
                ->assertJsonValidationErrors('entries.0.project_id');
            $this->assertSame('That project is not available for time logging.', $res->json('errors')['entries.0.project_id'][0]);
        }
        // A task from another project.
        $this->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60, $otherTask->id)]])
            ->assertJsonValidationErrors('entries.0.task_id');

        // Nothing to submit yet.
        $this->postJson($this->week($org).'/submit')->assertJsonValidationErrors('entries');
        $this->assertSame(0, Timesheet::where('user_id', $staff->id)->where('total_minutes', '>', 0)->count());
    }

    public function test_time_already_on_the_sheet_can_stay_after_the_project_is_archived(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60)]])->assertOk();
        $project->update(['archived_at' => now()]);

        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [
            $this->entry($project->id, '2026-11-02', 60), $this->entry($project->id, '2026-11-03', 120),
        ]])->assertOk()->assertJsonPath('data.total_minutes', 180);

        // Deleting the project keeps the hours and the name.
        $project->delete();
        $this->actingAs($staff)->getJson($this->week($org))->assertOk()
            ->assertJsonPath('data.entries.0.project_id', null)
            ->assertJsonPath('data.entries.0.project_name', $project->name);
    }

    public function test_who_can_see_a_timesheet(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $colleague = $this->addMember($org, Role::Staff);
        $otherManager = $this->addMember($org, Role::Manager);
        $admin = $this->addMember($org, Role::Admin);
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60)]])->assertOk();
        $sheetId = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()->json('data.id');
        $url = $this->api($org, "/timesheet/sheets/{$sheetId}");

        $this->actingAs($staff)->getJson($url)->assertOk()->assertJsonPath('data.permissions.withdraw', true);
        $this->actingAs($manager)->getJson($url)->assertOk();
        $this->actingAs($admin)->getJson($url)->assertOk();
        $this->actingAs($this->owner($org))->getJson($url)->assertOk();
        $this->actingAs($colleague)->getJson($url)->assertNotFound();
        $this->actingAs($otherManager)->getJson($url)->assertNotFound();
        $this->actingAs($colleague)->getJson($this->api($org, '/timesheet/sheets?scope=team'))->assertOk()->assertJsonCount(0, 'data');
        $this->actingAs($colleague)->getJson($this->api($org, '/timesheet/sheets?scope=all'))->assertForbidden();
        $this->actingAs($admin)->getJson($this->api($org, '/timesheet/sheets?scope=all&status=submitted'))->assertOk()->assertJsonCount(1, 'data');

        // A different reporting manager takes over: access follows the current line.
        $this->reportsTo($org, $staff, $otherManager);
        $this->actingAs($otherManager)->getJson($url)->assertOk();
        // The original manager is still the approver on the open request.
        $this->actingAs($manager)->getJson($url)->assertOk();

        // Another organisation: guessed IDs and cross-organisation URLs are 404.
        $foreign = $this->org('Other Co');
        $foreignOwner = $this->owner($foreign);
        $this->actingAs($foreignOwner)->getJson($url)->assertNotFound();
        $this->actingAs($foreignOwner)->getJson($this->api($foreign, "/timesheet/sheets/{$sheetId}"))->assertNotFound();
        $this->actingAs($foreignOwner)->postJson($this->api($foreign, "/timesheet/sheets/{$sheetId}/withdraw"))->assertNotFound();
        $this->actingAs($staff)->getJson($this->api($org, '/timesheet/projects/'.$this->createProject($foreign, $foreignOwner, [], 'organization')->id.'/tasks'))->assertNotFound();
    }

    public function test_app_must_be_installed_and_allowed(): void
    {
        [$org, $staff] = $this->team();
        $app = LauncherApp::where('key', 'timesheet')->firstOrFail();

        AppRolePermission::create(['organization_id' => $org->id, 'app_id' => $app->id, 'role' => 'staff', 'abilities' => []]);
        $this->actingAs($staff)->getJson($this->week($org))->assertNotFound();

        AppRolePermission::where('organization_id', $org->id)->delete();
        $this->actingAs($staff)->getJson($this->week($org))->assertOk();

        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/admin/apps/timesheet'))->assertSuccessful();
        $this->actingAs($staff)->getJson($this->week($org))->assertNotFound();
    }

    public function test_project_and_task_pickers_only_offer_what_the_member_can_log_to(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $hidden = $this->createProject($org, $manager, []);
        $open = $this->createProject($org, $manager, [], 'organization');
        $mine = $this->createTask($project, $staff, ['title' => 'Mine']);
        $this->createTask($project, null, ['title' => 'Someone else', 'status' => 'done']);

        $ids = $this->actingAs($staff)->getJson($this->api($org, '/timesheet/projects'))->assertOk()->collect('data')->pluck('id')->all();
        $this->assertSame([$project->id], $ids);

        $this->actingAs($staff)->getJson($this->api($org, "/timesheet/projects/{$project->id}/tasks"))->assertOk()
            ->assertJsonPath('data.0.id', $mine->id)->assertJsonPath('data.0.assigned_to_me', true);
        $this->actingAs($staff)->getJson($this->api($org, "/timesheet/projects/{$hidden->id}/tasks"))->assertNotFound();
        // Visible to everyone, but the member is not on it.
        $this->actingAs($staff)->getJson($this->api($org, "/timesheet/projects/{$open->id}/tasks"))->assertForbidden();
    }

    public function test_reports_are_scoped_and_exclude_drafts(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $colleague = $this->addMember($org, Role::Staff);
        $project->memberships()->create(['organization_id' => $org->id, 'user_id' => $colleague->id, 'role' => 'member']);
        $side = $this->createProject($org, $this->owner($org), [$colleague]);

        // Colleague (reports to nobody) logs on the manager's project and on another project.
        $this->actingAs($colleague)->putJson($this->week($org), ['entries' => [
            $this->entry($project->id, '2026-11-02', 120), $this->entry($side->id, '2026-11-02', 180, null, '=HYPERLINK("x")'),
        ]])->assertOk();
        $this->actingAs($colleague)->postJson($this->week($org).'/submit')->assertOk();
        // Staff logs a submitted week and a draft.
        $this->actingAs($staff)->putJson($this->week($org, self::LAST_WEEK), ['entries' => [$this->entry($project->id, '2026-10-27', 240)]])->assertOk();
        $this->actingAs($staff)->postJson($this->week($org, self::LAST_WEEK).'/submit')->assertOk();
        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-03', 600)]])->assertOk();

        $range = '?from=2026-10-01&to=2026-11-30';

        // Manager: direct report's sheets + all hours on the project they manage, not the side project.
        $this->actingAs($manager)->getJson($this->api($org, '/timesheet/report'.$range.'&group_by=project'))->assertOk()
            ->assertJsonPath('data.total_minutes', 360)
            ->assertJsonCount(1, 'data.rows')
            ->assertJsonPath('data.rows.0.label', $project->name);

        // Staff: only their own submitted hours (the draft does not count).
        $this->actingAs($staff)->getJson($this->api($org, '/timesheet/report'.$range.'&group_by=member'))->assertOk()
            ->assertJsonPath('data.total_minutes', 240)
            ->assertJsonPath('data.rows.0.label', $staff->name);

        // Owner (Timesheet admin): everything submitted; "approved" only counts approved weeks.
        $this->actingAs($this->owner($org))->getJson($this->api($org, '/timesheet/report'.$range))->assertOk()
            ->assertJsonPath('data.total_minutes', 540)->assertJsonPath('data.members', 2);
        $this->actingAs($this->owner($org))->getJson($this->api($org, '/timesheet/report'.$range.'&status=approved'))->assertOk()
            ->assertJsonPath('data.total_minutes', 0);

        // CSV export neutralises formulas.
        $csv = $this->actingAs($this->owner($org))->get($this->api($org, '/timesheet/report'.$range.'&format=csv'))->assertOk()->streamedContent();
        $this->assertStringContainsString('Date,Member,Project,Task,Hours,Status,Note', $csv);
        $this->assertStringContainsString("'=HYPERLINK", $csv);
        $this->assertStringNotContainsString(',=HYPERLINK', $csv);

        // Another organisation sees none of it.
        $foreign = $this->org('Other Co');
        $this->actingAs($this->owner($foreign))->getJson($this->api($foreign, '/timesheet/report'.$range))->assertOk()
            ->assertJsonPath('data.total_minutes', 0);
    }

    public function test_settings_choose_the_workflow(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $owner = $this->owner($org);
        $finance = $this->addMember($org, Role::Admin);
        $workflow = ApprovalWorkflow::create(['organization_id' => $org->id, 'name' => 'Finance check', 'created_by' => $owner->id]);
        $workflow->steps()->create(['organization_id' => $org->id, 'position' => 1, 'name' => 'Finance', 'mode' => 'any',
            'approvers' => [['type' => 'user', 'user_id' => $finance->id]]]);
        $foreign = $this->org('Other Co');
        $foreignWorkflow = ApprovalWorkflow::create(['organization_id' => $foreign->id, 'name' => 'Theirs']);

        $this->actingAs($staff)->getJson($this->api($org, '/timesheet/settings'))->assertForbidden();
        $this->actingAs($manager)->putJson($this->api($org, '/timesheet/settings'), ['workflow_id' => $workflow->id])->assertForbidden();
        $this->actingAs($owner)->putJson($this->api($org, '/timesheet/settings'), ['workflow_id' => $foreignWorkflow->id])
            ->assertJsonValidationErrors('workflow_id');
        $this->actingAs($owner)->putJson($this->api($org, '/timesheet/settings'), ['workflow_id' => $workflow->id])->assertOk()
            ->assertJsonPath('data.workflow_id', $workflow->id);

        $this->actingAs($staff)->putJson($this->week($org), ['entries' => [$this->entry($project->id, '2026-11-02', 60)]])->assertOk();
        $requestId = $this->actingAs($staff)->postJson($this->week($org).'/submit')->assertOk()
            ->assertJsonPath('data.approval.current_step', 'Finance')->json('data.approval.id');
        $this->assertSame($workflow->id, ApprovalRequest::findOrFail($requestId)->workflow_id);

        // Back to the default: a "Timesheet approval" workflow is created.
        $this->actingAs($owner)->putJson($this->api($org, '/timesheet/settings'), ['workflow_id' => null])->assertOk();
        $this->assertNotNull($this->actingAs($owner)->getJson($this->api($org, '/timesheet/settings'))->json('data.workflow_id'));
    }

    public function test_removed_member_keeps_their_history_and_unsubmitted_weeks_get_one_reminder(): void
    {
        [$org, $staff, $manager, $project] = $this->team();
        $this->actingAs($staff)->putJson($this->week($org, self::LAST_WEEK), ['entries' => [$this->entry($project->id, '2026-10-27', 60)]])->assertOk();

        Artisan::call('rakanspace:timesheet-reminders');
        Artisan::call('rakanspace:timesheet-reminders');
        $this->assertSame(1, UserNotification::where('user_id', $staff->id)->where('type', 'timesheet.reminder')->count());

        $other = $this->org('Other Co');
        $this->addMember($other, Role::Staff, $staff);
        $this->actingAs($this->owner($org))->deleteJson($this->api($org, '/members/'.$this->membership($org, $staff)->id))->assertSuccessful();

        $this->assertSame(1, Timesheet::where('organization_id', $org->id)->where('user_id', $staff->id)->count());
        $staff->forgetMembershipCache();
        $this->actingAs($staff)->getJson($this->week($org))->assertNotFound();
        $this->actingAs($staff)->getJson($this->week($other))->assertOk();
    }
}
