<?php

namespace Tests\Feature;

use App\Models\Attachment;
use Illuminate\Database\QueryException;
use Tests\TestCase;

/** Client-supplied IDs that point into another organisation are rejected. */
class CrossOrganizationReferenceTest extends TestCase
{
    public function test_cannot_reference_users_from_another_organisation(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $stranger = $this->owner($this->createOrganization(null, 'Elsewhere'));
        $project = $this->createProject($org, $owner);

        $this->actingAs($owner);
        $this->postJson($this->api($org, "/projects/{$project->id}/tasks"), ['title' => 'x', 'assignee_id' => $stranger->id])->assertStatus(422);
        $this->postJson($this->api($org, '/projects'), ['name' => 'P', 'member_ids' => [$stranger->id]])->assertStatus(422);
        $this->putJson($this->api($org, "/projects/{$project->id}/members"), ['members' => [['user_id' => $stranger->id, 'role' => 'member']]])->assertStatus(422);
        $this->postJson($this->api($org, '/channels'), ['name' => 'secret', 'visibility' => 'private', 'member_ids' => [$stranger->id]])->assertStatus(422);
        $this->postJson($this->api($org, '/direct-conversations'), ['user_id' => $stranger->id])->assertStatus(422);
        $this->postJson($this->api($org, '/events'), [
            'title' => 'x', 'starts_at' => now()->addDay()->toIso8601String(), 'ends_at' => now()->addDay()->addHour()->toIso8601String(),
            'audience' => 'participants', 'participant_ids' => [$stranger->id],
        ])->assertStatus(422);
        $department = $org->departments()->create(['name' => 'Ops']);
        $this->putJson($this->api($org, "/departments/{$department->id}/members"), ['user_ids' => [$stranger->id]])->assertStatus(422);
    }

    public function test_cannot_attach_files_uploaded_in_another_organisation_or_by_someone_else(): void
    {
        $org = $this->createOrganization();
        $owner = $this->owner($org);
        $colleague = $this->addMember($org);
        $project = $this->createProject($org, $owner, [$colleague]);
        $otherOrg = $this->createOrganization($owner, 'Second Co');

        $foreign = Attachment::create(['organization_id' => $otherOrg->id, 'uploader_id' => $owner->id, 'disk' => 'local',
            'path' => 'attachments/a.pdf', 'original_name' => 'a.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf', 'size' => 1]);
        $colleagues = Attachment::create(['organization_id' => $org->id, 'uploader_id' => $colleague->id, 'disk' => 'local',
            'path' => 'attachments/b.pdf', 'original_name' => 'b.pdf', 'extension' => 'pdf', 'mime_type' => 'application/pdf', 'size' => 1]);

        $this->actingAs($owner);
        $this->postJson($this->api($org, "/projects/{$project->id}/tasks"), ['title' => 'x', 'attachment_ids' => [$foreign->id]])
            ->assertStatus(422)->assertJsonValidationErrors('attachment_ids');
        $this->postJson($this->api($org, "/projects/{$project->id}/files"), ['attachment_ids' => [$colleagues->id]])
            ->assertStatus(422);
        $this->assertSame(0, $project->tasks()->count());
        $this->assertNull($colleagues->fresh()->attachable_type);
    }

    public function test_database_rejects_tasks_pointing_at_another_organisations_project(): void
    {
        $orgA = $this->createOrganization(null, 'A');
        $orgB = $this->createOrganization(null, 'B');
        $project = $this->createProject($orgA, $this->owner($orgA));

        $this->expectException(QueryException::class);
        $project->tasks()->create(['organization_id' => $orgB->id, 'title' => 'sneaky']);
    }

    public function test_department_targeted_announcement_must_use_own_department(): void
    {
        $org = $this->createOrganization();
        $otherDept = $this->createOrganization(null, 'B')->departments()->create(['name' => 'Finance']);

        $this->actingAs($this->owner($org))->postJson($this->api($org, '/announcements'), [
            'title' => 'x', 'body' => 'y', 'audience' => 'department', 'department_id' => $otherDept->id,
        ])->assertStatus(422)->assertJsonValidationErrors('department_id');
    }
}
