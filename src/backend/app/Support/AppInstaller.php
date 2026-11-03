<?php

namespace App\Support;

use App\Models\AppAccessRequest;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\OrganizationApp;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Installs and uninstalls apps for an organisation. Callers check
 * Permissions::canManageApps() first.
 */
class AppInstaller
{
    /** Idempotent. Also approves pending access requests for the app. */
    public static function install(Organization $organization, LauncherApp $app, User $actor): OrganizationApp
    {
        return DB::transaction(function () use ($organization, $app, $actor) {
            $installed = OrganizationApp::firstOrCreate(
                ['organization_id' => $organization->id, 'app_id' => $app->id],
                ['installed_by' => $actor->id, 'installed_at' => now()],
            );

            if ($installed->wasRecentlyCreated) {
                ActivityLog::audit($organization->id, $actor, 'app.installed', $app, ['app' => $app->key]);
            }

            $pending = AppAccessRequest::where('organization_id', $organization->id)
                ->where('app_id', $app->id)
                ->where('status', AppAccessRequest::STATUS_PENDING)
                ->lockForUpdate()->get();

            if ($pending->isNotEmpty()) {
                AppAccessRequest::whereKey($pending->modelKeys())->update([
                    'status' => AppAccessRequest::STATUS_APPROVED,
                    'decided_by' => $actor->id,
                    'decided_at' => now(),
                ]);
                Notifier::send(
                    $organization->id,
                    $pending->pluck('user_id'),
                    'app.request_approved',
                    $app->name.' is now available',
                    'Your request was approved. Open it from the app launcher.',
                    $app->path(),
                    $actor->id,
                    'app-installed:'.$installed->id,
                    ['app' => $app->key],
                    email: true,
                );
            }

            Permissions::forgetAppAbilities();

            return $installed;
        });
    }

    /** Removes the app for everyone. Pins go; role settings are kept for a reinstall. */
    public static function uninstall(Organization $organization, LauncherApp $app, User $actor): void
    {
        DB::transaction(function () use ($organization, $app, $actor) {
            $deleted = OrganizationApp::where('organization_id', $organization->id)->where('app_id', $app->id)->delete();
            DB::table('user_app_pins')->where('organization_id', $organization->id)->where('app_id', $app->id)->delete();

            if ($deleted) {
                ActivityLog::audit($organization->id, $actor, 'app.uninstalled', $app, ['app' => $app->key]);
            }
            Permissions::forgetAppAbilities();
        });
    }
}
