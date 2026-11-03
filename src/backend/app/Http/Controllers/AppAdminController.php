<?php

namespace App\Http\Controllers;

use App\Enums\AppAbility;
use App\Http\Resources\AppAccessRequestResource;
use App\Http\Resources\AppResource;
use App\Models\AppAccessRequest;
use App\Models\AppRolePermission;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\OrganizationApp;
use App\Support\ActivityLog;
use App\Support\AppCatalog;
use App\Support\AppInstaller;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/**
 * Owner/Admin management of the organisation's apps: install, uninstall,
 * per-role abilities and access requests.
 */
class AppAdminController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $this->requireManager($request, $organization);

        $installed = OrganizationApp::where('organization_id', $organization->id)->get()->keyBy('app_id');
        $overrides = AppRolePermission::where('organization_id', $organization->id)->get()->groupBy('app_id');
        $pending = AppAccessRequest::where('organization_id', $organization->id)->where('status', AppAccessRequest::STATUS_PENDING)
            ->selectRaw('app_id, count(*) as total')->groupBy('app_id')->pluck('total', 'app_id');

        $apps = LauncherApp::orderBy('sort_order')->orderBy('id')->get()->map(fn (LauncherApp $app) => [
            ...(new AppResource($app))->resolve($request),
            'installed' => $installed->has($app->id),
            'installed_at' => $installed->get($app->id)?->installed_at?->toIso8601String(),
            'role_abilities' => $this->roleAbilities($overrides->get($app->id, collect()), $app->key),
            'pending_requests' => (int) ($pending[$app->id] ?? 0),
        ]);

        return response()->json(['data' => $apps, 'meta' => ['abilities' => AppAbility::values()]]);
    }

    public function install(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $this->requireManager($request, $organization);
        AppInstaller::install($organization, LauncherApp::findByKeyOrFail($appKey), $request->user());

        return response()->json(['message' => 'App installed.']);
    }

    public function uninstall(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $this->requireManager($request, $organization);
        AppInstaller::uninstall($organization, LauncherApp::findByKeyOrFail($appKey), $request->user());

        return response()->json(['message' => 'App uninstalled.']);
    }

    /** Sets abilities for configurable roles (Manager, Staff). Owner/Admin always have all. */
    public function updatePermissions(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $this->requireManager($request, $organization);
        $app = LauncherApp::findByKeyOrFail($appKey);
        $roles = array_map(fn ($r) => $r->value, AppCatalog::configurableRoles());

        $data = $request->validate([
            'roles' => ['required', 'array:'.implode(',', $roles)],
            'roles.*' => ['present', 'array'],
            'roles.*.*' => ['string', Rule::in(AppAbility::values())],
        ]);

        DB::transaction(function () use ($organization, $app, $data, $request) {
            foreach ($data['roles'] as $role => $abilities) {
                AppRolePermission::updateOrCreate(
                    ['organization_id' => $organization->id, 'app_id' => $app->id, 'role' => $role],
                    ['abilities' => AppAbility::normalize($abilities)],
                );
            }
            ActivityLog::audit($organization->id, $request->user(), 'app.permissions_changed', $app, [
                'app' => $app->key,
                'roles' => collect($data['roles'])->map(fn ($a) => AppAbility::normalize($a))->all(),
            ]);
        });

        Permissions::forgetAppAbilities();
        $overrides = AppRolePermission::where('organization_id', $organization->id)->where('app_id', $app->id)->get();

        return response()->json(['data' => ['key' => $app->key, 'role_abilities' => $this->roleAbilities($overrides, $app->key)]]);
    }

    public function requests(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $this->requireManager($request, $organization);
        $request->validate([
            'status' => ['nullable', Rule::in(['pending', 'approved', 'rejected', 'all'])],
            'q' => ['nullable', 'string', 'max:100'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $status = $request->input('status', 'pending');

        $query = $organization->accessRequests()->with(['app', 'user', 'decider'])
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w
                    ->whereHas('user', fn ($u) => $u->where('name', 'ilike', $term))
                    ->orWhereHas('app', fn ($a) => $a->where('name', 'ilike', $term)));
            })
            ->latest('id');

        return AppAccessRequestResource::collection($query->paginate($request->integer('per_page', 20)));
    }

    public function approve(Request $request, Organization $organization, AppAccessRequest $accessRequest): JsonResponse
    {
        $this->requireManager($request, $organization);
        abort_unless($accessRequest->status === AppAccessRequest::STATUS_PENDING, 422, 'This request has already been decided.');

        // Installing approves every pending request for the app and notifies the requesters.
        AppInstaller::install($organization, $accessRequest->app, $request->user());

        return response()->json(['data' => new AppAccessRequestResource($accessRequest->fresh(['app', 'user', 'decider']))]);
    }

    public function reject(Request $request, Organization $organization, AppAccessRequest $accessRequest): JsonResponse
    {
        $this->requireManager($request, $organization);
        $data = $request->validate(['reason' => ['nullable', 'string', 'max:500']]);
        abort_unless($accessRequest->status === AppAccessRequest::STATUS_PENDING, 422, 'This request has already been decided.');

        DB::transaction(function () use ($organization, $accessRequest, $request, $data) {
            $accessRequest->update([
                'status' => AppAccessRequest::STATUS_REJECTED, 'decided_by' => $request->user()->id, 'decided_at' => now(),
            ]);
            ActivityLog::audit($organization->id, $request->user(), 'app.request_rejected', $accessRequest, [
                'app' => $accessRequest->app->key, 'user_id' => $accessRequest->user_id,
            ]);
            Notifier::send(
                $organization->id, [$accessRequest->user_id], 'app.request_rejected',
                'Your request for '.$accessRequest->app->name.' was declined',
                $data['reason'] ?? null, null, $request->user()->id, 'app-request-rejected:'.$accessRequest->id, ['app' => $accessRequest->app->key], email: true,
            );
        });

        return response()->json(['data' => new AppAccessRequestResource($accessRequest->fresh(['app', 'user', 'decider']))]);
    }

    /** @return array<string, list<string>> */
    private function roleAbilities($overrides, string $appKey): array
    {
        $result = [];
        foreach (AppCatalog::configurableRoles() as $role) {
            $row = $overrides->firstWhere('role', $role->value);
            $result[$role->value] = $row ? AppAbility::normalize($row->abilities ?? []) : AppCatalog::defaultAbilities($role, $appKey);
        }

        return $result;
    }

    private function requireManager(Request $request, Organization $organization): void
    {
        abort_unless(Permissions::canManageApps($request->user(), $organization->id), 403, 'Only owners and admins can manage apps.');
    }
}
