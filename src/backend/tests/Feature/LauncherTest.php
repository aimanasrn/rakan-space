<?php

namespace Tests\Feature;

use App\Enums\Role;
use App\Mail\NotificationMail;
use App\Models\AppAccessRequest;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\User;
use App\Models\UserNotification;
use App\Support\AppCatalog;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;

class LauncherTest extends TestCase
{
    private const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

    private function orgWithApps(string $name = 'Acme Sdn Bhd'): Organization
    {
        $org = $this->createOrganization(null, $name);
        AppCatalog::installDefaults($org, $this->owner($org));

        return $org;
    }

    private function banner(Organization $org, array $attrs = [])
    {
        return $org->banners()->create([
            'title' => 'Center of Excellence', 'description' => 'Train talent', 'cta_label' => 'Learn more', 'cta_url' => '/apps/lms', ...$attrs,
        ]);
    }

    public function test_staff_sees_installed_and_marketplace_apps_and_only_live_banners(): void
    {
        $org = $this->orgWithApps();
        $staff = $this->addMember($org);
        $this->banner($org, ['title' => 'Live']);
        $this->banner($org, ['title' => 'Inactive', 'is_active' => false]);
        $this->banner($org, ['title' => 'Future', 'starts_at' => now()->addDay()]);
        $this->banner($org, ['title' => 'Expired', 'ends_at' => now()->subMinute()]);

        $res = $this->actingAs($staff)->getJson($this->api($org, '/launcher'))->assertOk();

        $this->assertSame(['form', 'approval', 'project', 'timesheet', 'leave', 'helpdesk', 'opportunity', 'lms'], array_column($res->json('data.installed'), 'key'));
        $this->assertSame(['checkin', 'videcard'], array_column($res->json('data.marketplace'), 'key'));
        $this->assertSame(['Live'], array_column($res->json('data.banners'), 'title'));
        // Form: staff fill forms but do not build them by default. Other apps: view + create.
        $res->assertJsonPath('data.installed.0.abilities', ['view'])
            ->assertJsonPath('data.installed.1.abilities', ['view', 'create'])
            ->assertJsonPath('data.installed.2.path', '/projects')
            ->assertJsonPath('data.installed.0.pinned', false)
            ->assertJsonPath('data.can_manage', false);
    }

    public function test_owner_has_every_ability_and_can_manage(): void
    {
        $org = $this->orgWithApps();
        $this->actingAs($this->owner($org))->getJson($this->api($org, '/launcher'))
            ->assertJsonPath('data.installed.0.abilities', ['view', 'create', 'edit', 'delete', 'approve', 'admin'])
            ->assertJsonPath('data.can_manage', true);
    }

    public function test_role_without_abilities_cannot_see_or_open_the_app(): void
    {
        $org = $this->orgWithApps();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);

        $this->actingAs($owner)->putJson($this->api($org, '/admin/apps/helpdesk/permissions'), ['roles' => ['staff' => []]])->assertOk();

        $res = $this->actingAs($staff)->getJson($this->api($org, '/launcher'))->assertOk();
        $this->assertNotContains('helpdesk', array_column($res->json('data.installed'), 'key'));
        $this->assertNotContains('helpdesk', array_column($res->json('data.marketplace'), 'key'));
        $this->getJson($this->api($org, '/apps/helpdesk'))->assertNotFound();
        $this->patchJson($this->api($org, '/user-apps/helpdesk/pin'), ['pinned' => true])->assertNotFound();
        $this->getJson($this->api($org, '/apps/form'))->assertOk()->assertJsonPath('data.abilities', ['view']);
    }

    public function test_permissions_are_normalised_and_only_manager_and_staff_are_configurable(): void
    {
        $org = $this->orgWithApps();
        $owner = $this->owner($org);

        $this->actingAs($owner)->putJson($this->api($org, '/admin/apps/form/permissions'), ['roles' => ['staff' => ['create', 'approve']]])
            ->assertOk()->assertJsonPath('data.role_abilities.staff', ['view', 'create', 'approve'])
            // Form-specific default: managers build and manage their own forms only.
            ->assertJsonPath('data.role_abilities.manager', ['view', 'create', 'approve']);

        $this->putJson($this->api($org, '/admin/apps/form/permissions'), ['roles' => ['owner' => []]])->assertUnprocessable();
        $this->putJson($this->api($org, '/admin/apps/form/permissions'), ['roles' => ['staff' => ['hack']]])->assertUnprocessable();
        $this->getJson($this->api($org, '/launcher'))->assertJsonPath('data.installed.0.abilities.5', 'admin');
    }

    public function test_pin_toggle_is_idempotent_and_limited_to_usable_apps(): void
    {
        $org = $this->orgWithApps();
        $staff = $this->addMember($org);
        $this->actingAs($staff);

        $this->patchJson($this->api($org, '/user-apps/timesheet/pin'), ['pinned' => true])->assertOk()->assertJsonPath('data.pinned', true);
        $this->patchJson($this->api($org, '/user-apps/timesheet/pin'), ['pinned' => true])->assertOk();
        $this->assertDatabaseCount('user_app_pins', 1);
        $this->getJson($this->api($org, '/launcher'))->assertJsonPath('data.installed.3.pinned', true);

        $this->patchJson($this->api($org, '/user-apps/timesheet/pin'), ['pinned' => false])->assertOk();
        $this->assertDatabaseCount('user_app_pins', 0);

        // Marketplace (not installed) and unknown apps cannot be pinned.
        $this->patchJson($this->api($org, '/user-apps/checkin/pin'), ['pinned' => true])->assertNotFound();
        $this->patchJson($this->api($org, '/user-apps/nope/pin'), ['pinned' => true])->assertNotFound();
        $this->patchJson($this->api($org, '/user-apps/form/pin'), [])->assertUnprocessable();
    }

    public function test_staff_cannot_install_but_can_request_access_and_admins_are_notified(): void
    {
        Mail::fake();
        $org = $this->orgWithApps();
        $owner = $this->owner($org);
        $admin = $this->addMember($org, Role::Admin);
        $manager = $this->addMember($org, Role::Manager);
        $staff = $this->addMember($org);
        $this->actingAs($staff);

        $this->postJson($this->api($org, '/user-apps/checkin/install'))->assertForbidden();

        $id = $this->postJson($this->api($org, '/user-apps/checkin/request-access'), ['note' => 'Client visits'])
            ->assertCreated()->json('data.request_id');
        // Asking again returns the same pending request.
        $this->postJson($this->api($org, '/user-apps/checkin/request-access'))->assertOk()->assertJsonPath('data.request_id', $id);
        $this->getJson($this->api($org, '/launcher'))->assertJsonPath('data.marketplace.0.request_pending', true);

        $this->assertSame(1, UserNotification::where('user_id', $owner->id)->where('type', 'app.access_requested')->count());
        $this->assertSame(1, UserNotification::where('user_id', $admin->id)->where('type', 'app.access_requested')->count());
        $this->assertSame(0, UserNotification::where('user_id', $manager->id)->count());
        Mail::assertQueued(NotificationMail::class, 2);

        // Installed apps cannot be requested.
        $this->postJson($this->api($org, '/user-apps/form/request-access'))->assertUnprocessable();
    }

    public function test_installing_approves_pending_requests_and_notifies_requesters(): void
    {
        Mail::fake();
        $org = $this->orgWithApps();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);

        $requestId = $this->actingAs($staff)->postJson($this->api($org, '/user-apps/videcard/request-access'))->json('data.request_id');

        $this->actingAs($owner)->getJson($this->api($org, '/admin/app-requests'))->assertOk()->assertJsonPath('data.0.id', $requestId);
        $this->postJson($this->api($org, "/admin/app-requests/{$requestId}/approve"))->assertOk()->assertJsonPath('data.status', 'approved');
        $this->postJson($this->api($org, "/admin/app-requests/{$requestId}/approve"))->assertUnprocessable();

        $this->assertSame(1, UserNotification::where('user_id', $staff->id)->where('type', 'app.request_approved')->count());
        $keys = array_column($this->actingAs($staff)->getJson($this->api($org, '/launcher'))->json('data.installed'), 'key');
        $this->assertContains('videcard', $keys);
        $this->assertDatabaseHas('activities', ['organization_id' => $org->id, 'event' => 'app.installed', 'is_audit' => true]);
    }

    public function test_rejecting_a_request_notifies_the_requester(): void
    {
        $org = $this->orgWithApps();
        $staff = $this->addMember($org);
        $requestId = $this->actingAs($staff)->postJson($this->api($org, '/user-apps/checkin/request-access'))->json('data.request_id');

        $this->actingAs($this->owner($org))->postJson($this->api($org, "/admin/app-requests/{$requestId}/reject"), ['reason' => 'Not this quarter'])
            ->assertOk()->assertJsonPath('data.status', 'rejected');
        $this->assertSame(AppAccessRequest::STATUS_REJECTED, AppAccessRequest::find($requestId)->status);
        $this->assertSame(1, UserNotification::where('user_id', $staff->id)->where('type', 'app.request_rejected')->count());
    }

    public function test_uninstall_removes_the_app_and_its_pins(): void
    {
        $org = $this->orgWithApps();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $this->actingAs($staff)->patchJson($this->api($org, '/user-apps/lms/pin'), ['pinned' => true])->assertOk();

        $this->actingAs($owner)->deleteJson($this->api($org, '/admin/apps/lms'))->assertOk();

        $this->assertDatabaseCount('user_app_pins', 0);
        $res = $this->actingAs($staff)->getJson($this->api($org, '/launcher'));
        $this->assertContains('lms', array_column($res->json('data.marketplace'), 'key'));
        $this->getJson($this->api($org, '/apps/lms'))->assertNotFound();
    }

    public function test_admin_endpoints_are_forbidden_for_managers_and_staff(): void
    {
        $org = $this->orgWithApps();
        $banner = $this->banner($org);
        foreach ([Role::Manager, Role::Staff] as $role) {
            $this->actingAs($this->addMember($org, $role));
            $this->getJson($this->api($org, '/admin/apps'))->assertForbidden();
            $this->postJson($this->api($org, '/admin/apps/checkin/install'))->assertForbidden();
            $this->deleteJson($this->api($org, '/admin/apps/form'))->assertForbidden();
            $this->putJson($this->api($org, '/admin/apps/form/permissions'), ['roles' => ['staff' => []]])->assertForbidden();
            $this->getJson($this->api($org, '/launcher/banners'))->assertForbidden();
            $this->postJson($this->api($org, '/launcher/banners'), ['title' => 'Hi'])->assertForbidden();
            $this->patchJson($this->api($org, "/launcher/banners/{$banner->id}"), ['title' => 'Hi'])->assertForbidden();
            $this->deleteJson($this->api($org, "/launcher/banners/{$banner->id}"))->assertForbidden();
        }
    }

    public function test_other_organisations_cannot_reach_launcher_data_even_with_guessed_ids(): void
    {
        $orgA = $this->orgWithApps('Alpha');
        $banner = $this->banner($orgA);
        $request = AppAccessRequest::create([
            'organization_id' => $orgA->id, 'app_id' => LauncherApp::where('key', 'checkin')->value('id'), 'user_id' => $this->addMember($orgA)->id,
        ]);
        $orgB = $this->orgWithApps('Beta');
        $attacker = $this->owner($orgB);
        $this->actingAs($attacker);

        $this->getJson($this->api($orgA, '/launcher'))->assertNotFound();
        $this->postJson($this->api($orgA, '/user-apps/checkin/install'))->assertNotFound();
        // Using their own organisation's slug with IDs from the other organisation.
        $this->patchJson($this->api($orgB, "/launcher/banners/{$banner->id}"), ['title' => 'pwned'])->assertNotFound();
        $this->deleteJson($this->api($orgB, "/launcher/banners/{$banner->id}"))->assertNotFound();
        $this->getJson($this->api($orgB, "/launcher/banners/{$banner->id}/image"))->assertNotFound();
        $this->postJson($this->api($orgB, "/admin/app-requests/{$request->id}/approve"))->assertNotFound();
        $this->assertSame('Center of Excellence', $banner->fresh()->title);
        $this->assertSame(AppAccessRequest::STATUS_PENDING, $request->fresh()->status);
        // Their own launcher does not include Alpha's banner.
        $this->assertSame([], $this->getJson($this->api($orgB, '/launcher'))->json('data.banners'));
    }

    public function test_banner_crud_validation_and_image_visibility(): void
    {
        Storage::fake('local');
        $org = $this->orgWithApps();
        $owner = $this->owner($org);
        $staff = $this->addMember($org);
        $this->actingAs($owner);

        foreach (['javascript:alert(1)', '//evil.example', 'ftp://files.example', 'not a url'] as $bad) {
            $this->postJson($this->api($org, '/launcher/banners'), ['title' => 'Bad', 'cta_label' => 'Go', 'cta_url' => $bad])
                ->assertUnprocessable()->assertJsonValidationErrors('cta_url');
        }
        $this->postJson($this->api($org, '/launcher/banners'), ['title' => 'No label', 'cta_url' => '/apps/lms'])->assertJsonValidationErrors('cta_label');
        $this->postJson($this->api($org, '/launcher/banners'), ['title' => 'Dates', 'starts_at' => now()->addDay()->toIso8601String(), 'ends_at' => now()->toIso8601String()])
            ->assertJsonValidationErrors('ends_at');

        $id = $this->postJson($this->api($org, '/launcher/banners'), [
            'title' => 'Mainframe Academy', 'description' => 'Enrol now', 'cta_label' => 'Learn more', 'cta_url' => 'https://example.com/academy', 'illustration' => 'rocket',
        ])->assertCreated()->assertJsonPath('data.is_live', true)->json('data.id');

        $this->postJson($this->api($org, "/launcher/banners/{$id}/image"), ['image' => UploadedFile::fake()->createWithContent('x.svg', '<svg onload="alert(1)"/>')])
            ->assertUnprocessable();
        $this->postJson($this->api($org, "/launcher/banners/{$id}/image"), ['image' => UploadedFile::fake()->createWithContent('hero.png', base64_decode(self::PNG_1X1))])
            ->assertOk()->assertJsonPath('data.id', $id);

        $this->actingAs($staff)->get($this->api($org, "/launcher/banners/{$id}/image"))->assertOk();

        $this->actingAs($owner)->patchJson($this->api($org, "/launcher/banners/{$id}"), ['is_active' => false])->assertOk()->assertJsonPath('data.is_live', false);
        $this->get($this->api($org, "/launcher/banners/{$id}/image"))->assertOk();
        $this->actingAs($staff)->get($this->api($org, "/launcher/banners/{$id}/image"))->assertNotFound();

        $this->actingAs($owner)->getJson($this->api($org, '/launcher/banners?status=inactive&q=academy'))->assertOk()->assertJsonPath('meta.total', 1);
        $this->deleteJson($this->api($org, "/launcher/banners/{$id}"))->assertOk();
        $this->assertDatabaseMissing('launcher_banners', ['id' => $id]);
        $this->assertSame([], Storage::disk('local')->allFiles('launcher-banners'));
    }

    public function test_new_organisations_get_the_default_apps(): void
    {
        $user = User::factory()->create();
        $slug = $this->actingAs($user)->postJson('/api/orgs', ['name' => 'Syarikat Baru'])->assertCreated()
            ->assertJsonPath('data.permissions.manage_apps', true)->json('data.slug');

        $res = $this->getJson("/api/orgs/{$slug}/launcher")->assertOk();
        $this->assertCount(8, $res->json('data.installed'));
        $this->assertCount(2, $res->json('data.marketplace'));
    }
}
