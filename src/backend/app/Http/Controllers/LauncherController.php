<?php

namespace App\Http\Controllers;

use App\Http\Resources\AppResource;
use App\Http\Resources\LauncherBannerResource;
use App\Models\AppAccessRequest;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\OrganizationApp;
use App\Models\User;
use App\Models\UserAppPin;
use App\Support\AppInstaller;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Database\UniqueConstraintViolationException;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * App launcher for members: what they can open, pin, install or request.
 * Everything is filtered on the server by Permissions.
 */
class LauncherController extends Controller
{
    public function index(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        $abilities = Permissions::appAbilitiesMap($user, $organization->id);
        $installedIds = OrganizationApp::where('organization_id', $organization->id)->pluck('app_id')->flip();
        $pinned = UserAppPin::where('organization_id', $organization->id)->where('user_id', $user->id)->pluck('app_id')->flip();
        $requested = AppAccessRequest::where('organization_id', $organization->id)->where('user_id', $user->id)
            ->where('status', AppAccessRequest::STATUS_PENDING)->pluck('app_id')->flip();

        $installed = [];
        $marketplace = [];
        foreach (LauncherApp::orderBy('sort_order')->orderBy('id')->get() as $app) {
            $base = (new AppResource($app))->resolve($request);
            if (isset($abilities[$app->id])) {
                $installed[] = [...$base, 'pinned' => $pinned->has($app->id), 'abilities' => $abilities[$app->id]];
            } elseif (! $installedIds->has($app->id)) {
                $marketplace[] = [...$base, 'request_pending' => $requested->has($app->id)];
            }
            // Installed apps the member's role cannot use are not shown at all.
        }

        $banners = Permissions::visibleBannersQuery($user, $organization->id)
            ->orderBy('sort_order')->orderBy('id')->limit(10)->get();

        return response()->json(['data' => [
            'banners' => LauncherBannerResource::collection($banners)->resolve($request),
            'installed' => $installed,
            'marketplace' => $marketplace,
            'can_manage' => Permissions::canManageApps($user, $organization->id),
        ]]);
    }

    /** One installed app the member can open (used by each app's home page). */
    public function show(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $app = $this->usableApp($request, $organization, $appKey);

        return response()->json(['data' => [
            ...(new AppResource($app))->resolve($request),
            'abilities' => Permissions::appAbilities($request->user(), $organization->id, $app),
        ]]);
    }

    public function pin(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $data = $request->validate(['pinned' => ['required', 'boolean']]);
        $app = $this->usableApp($request, $organization, $appKey);
        $user = $request->user();

        if ($data['pinned']) {
            DB::table('user_app_pins')->insertOrIgnore([
                'organization_id' => $organization->id, 'user_id' => $user->id, 'app_id' => $app->id, 'created_at' => now(),
            ]);
        } else {
            UserAppPin::where('organization_id', $organization->id)->where('user_id', $user->id)->where('app_id', $app->id)->delete();
        }

        return response()->json(['data' => ['key' => $app->key, 'pinned' => (bool) $data['pinned']]]);
    }

    public function install(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $app = LauncherApp::findByKeyOrFail($appKey);
        abort_unless(Permissions::canManageApps($request->user(), $organization->id), 403, 'Only owners and admins can install apps. Request access instead.');

        AppInstaller::install($organization, $app, $request->user());

        return response()->json(['data' => [
            ...(new AppResource($app))->resolve($request),
            'pinned' => false,
            'abilities' => Permissions::appAbilities($request->user(), $organization->id, $app),
        ]], 201);
    }

    public function requestAccess(Request $request, Organization $organization, string $appKey): JsonResponse
    {
        $data = $request->validate(['note' => ['nullable', 'string', 'max:500']]);
        $app = LauncherApp::findByKeyOrFail($appKey);
        $user = $request->user();

        abort_if(OrganizationApp::where('organization_id', $organization->id)->where('app_id', $app->id)->exists(), 422, 'This app is already installed.');
        abort_if(Permissions::canManageApps($user, $organization->id), 422, 'You can install this app directly.');

        $pending = fn () => AppAccessRequest::where('organization_id', $organization->id)->where('app_id', $app->id)
            ->where('user_id', $user->id)->where('status', AppAccessRequest::STATUS_PENDING)->first();

        try {
            $accessRequest = $this->createAccessRequest($organization, $app, $user, $data['note'] ?? null, $pending);
        } catch (UniqueConstraintViolationException) {
            // A concurrent duplicate request; the partial unique index kept only one.
            $accessRequest = $pending();
        }

        return response()->json(['data' => ['key' => $app->key, 'request_pending' => true, 'request_id' => $accessRequest->id]], $accessRequest->wasRecentlyCreated ? 201 : 200);
    }

    private function createAccessRequest(Organization $organization, LauncherApp $app, User $user, ?string $note, \Closure $pending): AppAccessRequest
    {
        return DB::transaction(function () use ($organization, $app, $user, $note, $pending) {
            if ($existing = $pending()) {
                return $existing;
            }

            $created = AppAccessRequest::create([
                'organization_id' => $organization->id, 'app_id' => $app->id, 'user_id' => $user->id, 'note' => $note,
            ]);

            $admins = $organization->activeMemberships()->whereIn('role', ['owner', 'admin'])->pluck('user_id');
            Notifier::send(
                $organization->id, $admins, 'app.access_requested',
                $user->name.' requested '.$app->name,
                'Review the request in Settings → Apps.',
                '/settings/apps', $user->id, 'app-request:'.$created->id, ['app' => $app->key], email: true,
            );

            return $created;
        });
    }

    /** Installed and viewable by the user, otherwise 404 (existence is not revealed). */
    private function usableApp(Request $request, Organization $organization, string $appKey): LauncherApp
    {
        $app = LauncherApp::findByKeyOrFail($appKey);
        abort_unless(Permissions::canUseApp($request->user(), $organization->id, $app), 404);

        return $app;
    }
}
