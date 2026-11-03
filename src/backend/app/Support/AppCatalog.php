<?php

namespace App\Support;

use App\Enums\AppAbility;
use App\Enums\Role;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The list of business apps shown in the launcher. The catalogue is defined
 * in code and synced into the `apps` table (migration, seeder and the
 * `rakanspace:sync-apps` command). Organisations decide which apps they install.
 */
class AppCatalog
{
    /**
     * key => definition. "path" is relative to the workspace (/w/{slug}).
     * "default" apps are installed for every new organisation.
     */
    public const DEFINITIONS = [
        'form' => [
            'name' => 'Form', 'icon' => 'clipboard-list', 'gradient' => ['#6366f1', '#8b5cf6'], 'category' => 'Productivity', 'default' => true,
            'tagline' => 'Build forms and collect submissions',
            'description' => 'Drag-and-drop form builder with validation, conditional logic, versioning and optional approval workflows.',
        ],
        'approval' => [
            'name' => 'Approval', 'icon' => 'badge-check', 'gradient' => ['#10b981', '#059669'], 'category' => 'Productivity', 'default' => true,
            'tagline' => 'Workflows, inbox and delegation',
            'description' => 'Design sequential or parallel approval workflows, act on requests from one inbox and keep a full audit trail.',
        ],
        'project' => [
            'name' => 'Project', 'icon' => 'folder-kanban', 'gradient' => ['#0ea5e9', '#2563eb'], 'category' => 'Delivery', 'default' => true, 'path' => '/projects',
            'tagline' => 'Plan and deliver projects',
            'description' => 'Projects, milestones and tasks with list and Kanban views, members and progress tracking.',
        ],
        'timesheet' => [
            'name' => 'Timesheet', 'icon' => 'clock', 'gradient' => ['#f59e0b', '#ea580c'], 'category' => 'Delivery', 'default' => true,
            'tagline' => 'Weekly time tracking',
            'description' => 'Log hours per project and task, submit your week for approval and report on utilisation.',
        ],
        'helpdesk' => [
            'name' => 'Helpdesk', 'icon' => 'life-buoy', 'gradient' => ['#ef4444', '#db2777'], 'category' => 'Service', 'default' => true,
            'tagline' => 'Tickets, SLAs and knowledge base',
            'description' => 'Handle support tickets with assignment, SLA timers, internal notes, canned responses and a knowledge base.',
        ],
        'opportunity' => [
            'name' => 'Opportunity', 'icon' => 'trending-up', 'gradient' => ['#14b8a6', '#0891b2'], 'category' => 'Sales', 'default' => true,
            'tagline' => 'Sales pipeline and forecasts',
            'description' => 'Accounts, contacts and opportunities on a Kanban pipeline with activities, quotations and forecasts.',
        ],
        'lms' => [
            'name' => 'LMS', 'icon' => 'graduation-cap', 'gradient' => ['#a855f7', '#7c3aed'], 'category' => 'People', 'default' => true,
            'tagline' => 'Courses and training',
            'description' => 'Courses, learning paths, quizzes and certificates with learner progress reports.',
        ],
        'checkin' => [
            'name' => 'CheckIn', 'icon' => 'map-pin', 'gradient' => ['#22c55e', '#16a34a'], 'category' => 'People', 'default' => false,
            'tagline' => 'Attendance with GPS check-in',
            'description' => 'Check in and out from web or mobile with geofenced locations, shifts and attendance reports.',
        ],
        'videcard' => [
            'name' => 'Videcard', 'icon' => 'contact', 'gradient' => ['#f43f5e', '#e11d48'], 'category' => 'Sales', 'default' => false,
            'tagline' => 'Digital business cards',
            'description' => 'Shareable digital business cards with a QR code, vCard download and view analytics.',
        ],
    ];

    /**
     * App-specific defaults that differ from the general ones below.
     * Form: "view" = fill forms, "create" = build (and manage your own) forms,
     * "edit" = manage everyone's forms. Staff only fill; Managers build their own.
     */
    public const ROLE_DEFAULTS = [
        'form' => ['manager' => ['view', 'create', 'approve'], 'staff' => ['view']],
    ];

    /**
     * Abilities each role gets in an installed app unless the organisation
     * overrides them. Owners and Admins always have every ability.
     *
     * @return list<string>
     */
    public static function defaultAbilities(Role $role, ?string $appKey = null): array
    {
        if ($appKey !== null && isset(self::ROLE_DEFAULTS[$appKey][$role->value]) && ! $role->isAdministrator()) {
            return self::ROLE_DEFAULTS[$appKey][$role->value];
        }

        return match ($role) {
            Role::Owner, Role::Admin => AppAbility::values(),
            Role::Manager => ['view', 'create', 'edit', 'approve'],
            Role::Staff => ['view', 'create'],
        };
    }

    /** Roles whose abilities an organisation may customise. */
    public static function configurableRoles(): array
    {
        return [Role::Manager, Role::Staff];
    }

    public static function exists(string $key): bool
    {
        return array_key_exists($key, self::DEFINITIONS);
    }

    public static function path(string $key): string
    {
        return self::DEFINITIONS[$key]['path'] ?? '/apps/'.$key;
    }

    /** Upserts the catalogue into the `apps` table. Safe to run repeatedly. */
    public static function sync(): void
    {
        $order = 0;
        $now = now();
        $rows = [];
        foreach (self::DEFINITIONS as $key => $def) {
            $rows[] = [
                'key' => $key,
                'name' => $def['name'],
                'tagline' => $def['tagline'],
                'description' => $def['description'],
                'icon' => $def['icon'],
                'gradient_from' => $def['gradient'][0],
                'gradient_to' => $def['gradient'][1],
                'category' => $def['category'],
                'is_default' => $def['default'],
                'sort_order' => $order += 10,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        }

        DB::table('apps')->upsert($rows, ['key'], [
            'name', 'tagline', 'description', 'icon', 'gradient_from', 'gradient_to', 'category', 'is_default', 'sort_order', 'updated_at',
        ]);
    }

    /** Installs the default apps for a (new) organisation. */
    public static function installDefaults(Organization $organization, ?User $actor): void
    {
        $ids = LauncherApp::where('is_default', true)->pluck('id');
        $now = now();
        DB::table('organization_apps')->insertOrIgnore($ids->map(fn ($id) => [
            'organization_id' => $organization->id,
            'app_id' => $id,
            'installed_by' => $actor?->id,
            'installed_at' => $now,
            'created_at' => $now,
            'updated_at' => $now,
        ])->all());
    }
}
