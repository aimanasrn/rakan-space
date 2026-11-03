<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Events\UserEvent;
use App\Http\Resources\ActivityResource;
use App\Http\Resources\OrganizationResource;
use App\Models\Conversation;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Support\ActivityLog;
use App\Support\AppCatalog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

class OrganizationController extends Controller
{
    public function store(Request $request): JsonResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'timezone' => ['nullable', 'timezone:all'],
            'description' => ['nullable', 'string', 'max:1000'],
        ]);

        $user = $request->user();

        $organization = DB::transaction(function () use ($data, $user) {
            $organization = Organization::create([
                'name' => $data['name'],
                'slug' => Organization::uniqueSlug($data['name']),
                'timezone' => $data['timezone'] ?? 'Asia/Kuala_Lumpur',
                'description' => $data['description'] ?? null,
                'created_by' => $user->id,
            ]);

            OrganizationMembership::create([
                'organization_id' => $organization->id,
                'user_id' => $user->id,
                'role' => Role::Owner,
                'status' => OrganizationMembership::STATUS_ACTIVE,
                'joined_at' => now(),
            ]);

            // Every workspace starts with a public #general channel.
            $general = Conversation::create([
                'organization_id' => $organization->id,
                'type' => Conversation::TYPE_CHANNEL,
                'name' => 'general',
                'topic' => 'Company-wide conversation',
                'visibility' => Conversation::VISIBILITY_PUBLIC,
                'created_by' => $user->id,
            ]);
            $general->memberships()->create(['user_id' => $user->id, 'role' => 'admin', 'joined_at' => now()]);

            AppCatalog::installDefaults($organization, $user);
            ActivityLog::audit($organization->id, $user, 'organization.created', $organization);

            return $organization;
        });

        return response()->json(['data' => $this->payload($organization, $request)], 201);
    }

    public function show(Request $request, Organization $organization): JsonResponse
    {
        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    public function update(Request $request, Organization $organization): JsonResponse
    {
        $this->requireAdmin($request);

        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'min:2', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'timezone' => ['sometimes', 'required', 'timezone:all'],
            'industry' => ['nullable', 'string', 'max:120'],
            'website' => ['nullable', 'url:http,https', 'max:255'],
        ]);

        $organization->update($data);
        ActivityLog::audit($organization->id, $request->user(), 'organization.updated', $organization, ['fields' => array_keys($data)]);

        return response()->json(['data' => $this->payload($organization->fresh(), $request)]);
    }

    public function completeOnboarding(Request $request, Organization $organization): JsonResponse
    {
        $this->requireAdmin($request);
        $organization->forceFill(['onboarding_completed_at' => $organization->onboarding_completed_at ?? now()])->save();

        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    public function uploadLogo(Request $request, Organization $organization): JsonResponse
    {
        $this->requireAdmin($request);
        $request->validate([
            'logo' => ['required', 'file', 'mimes:jpg,jpeg,png,webp', 'max:2048', 'dimensions:max_width=4000,max_height=4000'],
        ]);

        $disk = Storage::disk(config('rakanspace.attachments.disk'));
        $file = $request->file('logo');
        $path = 'logos/'.$organization->id.'/'.Str::uuid().'.'.$file->extension();
        $disk->putFileAs(dirname($path), $file, basename($path));
        if ($organization->logo_path) {
            $disk->delete($organization->logo_path);
        }
        $organization->forceFill(['logo_path' => $path])->save();

        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    public function showLogo(Organization $organization): StreamedResponse
    {
        abort_unless($organization->logo_path, 404);
        $disk = Storage::disk(config('rakanspace.attachments.disk'));
        abort_unless($disk->exists($organization->logo_path), 404);

        return $disk->response($organization->logo_path, 'logo', [
            'Cache-Control' => 'private, max-age=86400',
            'X-Content-Type-Options' => 'nosniff',
        ]);
    }

    /** Make another active member an Owner; the current owner becomes Admin. */
    public function transferOwnership(Request $request, Organization $organization): JsonResponse
    {
        $current = $request->attributes->get('membership');
        abort_unless($current->role === Role::Owner, 403, 'Only an owner can transfer ownership.');

        $data = $request->validate([
            'membership_id' => ['required', 'integer'],
            'password' => ['required', 'current_password'],
        ]);

        DB::transaction(function () use ($organization, $current, $data, $request) {
            $target = OrganizationMembership::where('organization_id', $organization->id)
                ->where('status', OrganizationMembership::STATUS_ACTIVE)
                ->whereKey($data['membership_id'])->lockForUpdate()->first();

            abort_if(! $target || $target->id === $current->id, 422, 'Choose another active member.');

            $target->update(['role' => Role::Owner]);
            $current->update(['role' => Role::Admin]);

            ActivityLog::audit($organization->id, $request->user(), 'organization.ownership_transferred', $target, [
                'to_user_id' => $target->user_id,
            ]);
        });

        $request->user()->forgetMembershipCache();

        return response()->json(['data' => $this->payload($organization, $request)]);
    }

    public function auditLog(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->requireAdmin($request);

        $activities = $organization->activities()->with('actor')
            ->where('is_audit', true)->latest('id')->paginate(30);

        return ActivityResource::collection($activities);
    }

    private function requireAdmin(Request $request): void
    {
        abort_unless($request->attributes->get('membership')?->isAdministrator(), 403, 'Only owners and admins can do this.');
    }

    private function payload(Organization $organization, Request $request): array
    {
        $membership = $request->user()->membershipIn($organization);
        $role = $membership->role;

        return [
            ...(new OrganizationResource($organization))->resolve(),
            'membership' => ['id' => $membership->id, 'role' => $role->value],
            'members_count' => $organization->activeMemberships()->count(),
            'permissions' => [
                'manage_settings' => $role->isAdministrator(),
                'manage_members' => $role->isAdministrator(),
                'invite_members' => $role->isAdministrator(),
                'assignable_roles' => array_map(fn (Role $r) => $r->value, $role->assignableRoles()),
                'manage_departments' => $role->isAdministrator(),
                'transfer_ownership' => $role === Role::Owner,
                'view_audit_log' => $role->isAdministrator(),
                'create_projects' => $role->atLeast(Role::Manager),
                'publish_announcements' => $role->atLeast(Role::Manager),
                'create_org_events' => $role->atLeast(Role::Manager),
                'view_reports' => $role->atLeast(Role::Manager),
                'manage_apps' => $role->isAdministrator(),
            ],
        ];
    }

    /** Used by MemberController and others to notify a user their access changed. */
    public static function signalAccessRevoked(int $userId, int $organizationId): void
    {
        UserEvent::dispatch($userId, 'access.revoked', ['organization_id' => $organizationId]);
    }
}
