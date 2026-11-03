<?php

namespace Tests\Feature;

use App\Mail\InvitationMail;
use App\Models\User;
use App\Notifications\VerifyEmailNotification;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Notification;
use Tests\TestCase;

/**
 * Acceptance journey from the brief, exercised through the HTTP API:
 * owner registers → creates organisation → invites teammate → teammate
 * accepts → owner creates project + task → teammate updates task and sends
 * a message → notifications → an unrelated organisation sees nothing.
 */
class MainJourneyTest extends TestCase
{
    public function test_main_user_journey(): void
    {
        Mail::fake();
        Notification::fake();

        // 1. Owner registers, verifies email and creates an organisation.
        $this->postJson('/api/auth/register', [
            'name' => 'Nurul Huda', 'email' => 'nurul@example.com', 'password' => 'secret-pass-1', 'password_confirmation' => 'secret-pass-1',
        ])->assertCreated()->assertJsonPath('data.email_verified', false)->assertJsonPath('email_sent', true);
        $owner = User::where('email', 'nurul@example.com')->first();
        Notification::assertSentTo($owner, VerifyEmailNotification::class);

        // Unverified users cannot create workspaces.
        $this->flushSession()->actingAs($owner)->postJson('/api/orgs', ['name' => 'Syarikat Maju'])->assertForbidden();
        $owner->markEmailAsVerified();

        $slug = $this->flushSession()->actingAs($owner)->postJson('/api/orgs', ['name' => 'Syarikat Maju', 'timezone' => 'Asia/Kuala_Lumpur'])
            ->assertCreated()->assertJsonPath('data.membership.role', 'owner')->json('data.slug');
        $base = "/api/orgs/{$slug}";

        // 2. Owner invites a teammate.
        $this->postJson("{$base}/invitations", ['email' => 'farid@example.com', 'role' => 'staff'])->assertCreated();
        $token = null;
        Mail::assertSent(InvitationMail::class, function ($m) use (&$token) {
            $token = $m->token;

            return true;
        });

        // 3. Teammate registers with the invited email, verifies and accepts.
        $farid = User::factory()->create(['email' => 'farid@example.com', 'name' => 'Farid']);
        // Separate browser session (the registration request above stored the owner's session).
        $this->flushSession();
        $this->flushSession()->actingAs($farid)->postJson("/api/invitations/{$token}/accept")->assertOk()->assertJsonPath('organization.slug', $slug);

        // 4. Owner creates a project with the teammate and assigns a task.
        $projectId = $this->flushSession()->actingAs($owner)->postJson("{$base}/projects", [
            'name' => 'Pelancaran Produk', 'status' => 'active', 'member_ids' => [$farid->id],
        ])->assertCreated()->json('data.id');
        $taskId = $this->as($owner)->postJson("{$base}/projects/{$projectId}/tasks", [
            'title' => 'Siapkan slaid pelancaran', 'assignee_id' => $farid->id, 'due_date' => now()->addDays(3)->toDateString(),
        ])->assertCreated()->json('data.id');

        // 5. Teammate updates the task and sends a channel message mentioning the owner.
        $this->as($farid)->patchJson("{$base}/tasks/{$taskId}", ['status' => 'in_review'])->assertOk();
        $general = $this->as($farid)->getJson("{$base}/conversations")->assertOk()->collect('data')->firstWhere('name', 'general');
        $this->as($farid)->postJson("{$base}/conversations/{$general['id']}/messages", [
            'client_id' => fake()->uuid(), 'body' => 'Slides ready for review @Nurul', 'mentions' => [$owner->id],
        ])->assertCreated();

        // 6. Relevant users receive notifications.
        $this->as($farid)->getJson("{$base}/notifications")->assertOk()->assertJsonPath('data.0.type', 'task.assigned');
        $ownerTypes = $this->as($owner)->getJson("{$base}/notifications")->collect('data')->pluck('type')->all();
        $this->assertContains('task.updated', $ownerTypes);
        $this->assertContains('mention', $ownerTypes);
        $this->as($owner)->getJson("{$base}/dashboard")->assertOk()->assertJsonPath('data.projects.0.name', 'Pelancaran Produk');

        // 7. An unrelated organisation cannot access any of it.
        $stranger = User::factory()->create();
        $otherSlug = $this->as($stranger)->postJson('/api/orgs', ['name' => 'Unrelated Co'])->json('data.slug');
        $this->as($stranger)->getJson("{$base}/projects/{$projectId}")->assertNotFound();
        $this->as($stranger)->getJson("/api/orgs/{$otherSlug}/projects/{$projectId}")->assertNotFound();
        $this->as($stranger)->getJson("/api/orgs/{$otherSlug}/tasks/{$taskId}")->assertNotFound();
        $this->as($stranger)->getJson("/api/orgs/{$otherSlug}/conversations/{$general['id']}/messages")->assertNotFound();
        $this->as($stranger)->getJson("/api/orgs/{$otherSlug}/search?q=slides")->assertJsonPath('data.messages.total', 0);
    }

    /** Fresh browser session for the given user (queued jobs reset guards in tests). */
    private function as(User $user): static
    {
        return $this->flushSession()->actingAs($user);
    }
}
