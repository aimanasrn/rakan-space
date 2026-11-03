<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * Organisations created before the app launcher existed get the default apps,
 * matching what new organisations receive. Additive only.
 */
return new class extends Migration
{
    public function up(): void
    {
        DB::statement(<<<'SQL'
            INSERT INTO organization_apps (organization_id, app_id, installed_by, installed_at, created_at, updated_at)
            SELECT o.id, a.id, o.created_by, now(), now(), now()
            FROM organizations o
            CROSS JOIN apps a
            WHERE a.is_default
              AND NOT EXISTS (SELECT 1 FROM organization_apps x WHERE x.organization_id = o.id)
            ON CONFLICT (organization_id, app_id) DO NOTHING
        SQL);
    }

    public function down(): void
    {
        // Installs are kept; uninstalling would remove choices made since.
    }
};
