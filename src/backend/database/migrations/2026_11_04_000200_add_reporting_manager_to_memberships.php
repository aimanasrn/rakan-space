<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('organization_memberships', function (Blueprint $table) {
            // The user this member reports to, within the same organisation.
            $table->unsignedBigInteger('manager_id')->nullable()->after('role');
            $table->index(['organization_id', 'manager_id']);
        });

        // The manager must hold a membership in the same organisation. Deleting that
        // membership clears only manager_id (PostgreSQL 15+ column list).
        DB::statement('ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_manager_fk FOREIGN KEY (organization_id, manager_id) REFERENCES organization_memberships (organization_id, user_id) ON DELETE SET NULL (manager_id)');
        DB::statement('ALTER TABLE organization_memberships ADD CONSTRAINT organization_memberships_manager_not_self CHECK (manager_id IS NULL OR manager_id <> user_id)');
    }

    public function down(): void
    {
        DB::statement('ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS organization_memberships_manager_not_self');
        DB::statement('ALTER TABLE organization_memberships DROP CONSTRAINT IF EXISTS organization_memberships_manager_fk');
        Schema::table('organization_memberships', function (Blueprint $table) {
            $table->dropIndex(['organization_id', 'manager_id']);
            $table->dropColumn('manager_id');
        });
    }
};
