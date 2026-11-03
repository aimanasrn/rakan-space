<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Models\UserNotification;
use Tests\TestCase;

class TaskTest extends TestCase
{
    public function test_task_creation_assignment_and_status_changes(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $project = $this->createProject($org, $manager, [$staff]);

        $taskId = $this->actingAs($manager)->postJson($this->api($org, "/projects/{$project->id}/tasks"), [
            'title' => 'Prepare quarterly report',
            'priority' => 'high',
            'due_date' => '2026-12-01',
            'assignee_id' => $staff->id,
            'checklist' => ['Collect figures', 'Draft summary'],
        ])->assertCreated()
            ->assertJsonPath('data.status', 'todo')
            ->assertJsonPath('data.due_date', '2026-12-01')
            ->assertJsonPath('data.assignee.id', $staff->id)
            ->assertJsonCount(2, 'data.checklist')
            ->json('data.id');

        $this->assertDatabaseHas('user_notifications', ['user_id' => $staff->id, 'type' => 'task.assigned']);

        // Assignee moves the task through the workflow.
        $this->actingAs($staff)->postJson($this->api($org, "/tasks/{$taskId}/move"), ['status' => 'in_progress'])
            ->assertOk()->assertJsonPath('data.status', 'in_progress');
        $this->actingAs($staff)->patchJson($this->api($org, "/tasks/{$taskId}"), ['status' => 'done'])
            ->assertOk()->assertJsonPath('data.status', 'done');
        $this->assertNotNull($project->tasks()->find($taskId)->completed_at);

        $this->assertDatabaseHas('activities', ['subject_type' => 'task', 'subject_id' => $taskId, 'event' => 'task.status_changed']);
        $this->assertTrue(UserNotification::where('user_id', $manager->id)->where('type', 'task.updated')->exists());

        // My Tasks
        $this->actingAs($staff)->getJson($this->api($org, '/tasks?assignee=me'))->assertOk()->assertJsonCount(1, 'data');
    }

    public function test_project_member_cannot_edit_others_tasks_or_delete(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $a = $this->addMember($org);
        $b = $this->addMember($org);
        $project = $this->createProject($org, $manager, [$a, $b]);
        $task = $this->createTask($project, $a);

        $this->actingAs($b)->patchJson($this->api($org, "/tasks/{$task->id}"), ['status' => 'done'])->assertForbidden();
        $this->actingAs($a)->deleteJson($this->api($org, "/tasks/{$task->id}"))->assertForbidden();
        $this->actingAs($manager)->deleteJson($this->api($org, "/tasks/{$task->id}"))->assertOk();
    }

    public function test_assignee_must_be_project_member(): void
    {
        $org = $this->createOrganization();
        $manager = $this->addMember($org, Role::Manager);
        $notOnProject = $this->addMember($org);
        $project = $this->createProject($org, $manager);

        $this->actingAs($manager)->postJson($this->api($org, "/projects/{$project->id}/tasks"), [
            'title' => 'x', 'assignee_id' => $notOnProject->id,
        ])->assertStatus(422);
    }

    public function test_kanban_reorder_only_touches_same_project(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $project = $this->createProject($org, $owner);
        $other = $this->createProject($org, $owner);
        $t1 = $this->createTask($project);
        $t2 = $this->createTask($project);
        $foreign = $this->createTask($other, null, ['position' => 99]);

        $this->actingAs($owner)->postJson($this->api($org, "/tasks/{$t1->id}/move"), [
            'status' => 'todo', 'ordered_ids' => [$t2->id, $foreign->id, $t1->id],
        ])->assertOk();

        $this->assertSame(0, $t2->fresh()->position);
        $this->assertSame(2, $t1->fresh()->position);
        $this->assertSame(99, $foreign->fresh()->position);
    }

    public function test_archived_projects_are_read_only(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $project = $this->createProject($org, $owner);
        $task = $this->createTask($project);

        $this->actingAs($owner)->postJson($this->api($org, "/projects/{$project->id}/archive"))->assertOk()->assertJsonPath('data.archived', true);
        $this->postJson($this->api($org, "/projects/{$project->id}/tasks"), ['title' => 'x'])->assertForbidden();
        $this->patchJson($this->api($org, "/tasks/{$task->id}"), ['title' => 'y'])->assertForbidden();
    }
}
