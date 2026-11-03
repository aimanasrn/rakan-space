<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('organizations', function (Blueprint $table) {
            $table->id();
            $table->string('name', 120);
            $table->string('slug', 80)->unique();
            $table->text('description')->nullable();
            $table->string('logo_path')->nullable();
            $table->string('timezone', 64)->default('Asia/Kuala_Lumpur');
            $table->string('industry', 120)->nullable();
            $table->string('website')->nullable();
            $table->timestamp('onboarding_completed_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();
        });

        Schema::create('organization_memberships', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // owner | admin | manager | staff
            $table->string('role', 20);
            // active | deactivated | removed
            $table->string('status', 20)->default('active');
            $table->timestamp('joined_at')->nullable();
            $table->timestamp('status_changed_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'user_id']);
            $table->index(['user_id', 'status']);
            $table->index(['organization_id', 'status', 'role']);
        });

        Schema::create('departments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->text('description')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'name']);
            // Lets child tables reference (id, organization_id) so they cannot cross organisations.
            $table->unique(['id', 'organization_id']);
        });

        Schema::create('department_user', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('department_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->foreign(['department_id', 'organization_id'])
                ->references(['id', 'organization_id'])->on('departments')->cascadeOnDelete();
            $table->unique(['department_id', 'user_id']);
            $table->index(['organization_id', 'user_id']);
        });

        Schema::create('invitations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('email');
            $table->string('role', 20);
            $table->unsignedBigInteger('department_id')->nullable();
            // Only a SHA-256 hash of the token is stored.
            $table->string('token_hash', 64)->unique();
            $table->foreignId('invited_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('expires_at');
            $table->timestamp('accepted_at')->nullable();
            $table->foreignId('accepted_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamp('last_sent_at')->nullable();
            $table->unsignedInteger('send_count')->default(0);
            $table->timestamps();

            $table->index(['organization_id', 'email']);
        });

        // Deleting a department clears only department_id (PostgreSQL 15+ column list).
        DB::statement('ALTER TABLE invitations ADD CONSTRAINT invitations_department_fk FOREIGN KEY (department_id, organization_id) REFERENCES departments (id, organization_id) ON DELETE SET NULL (department_id)');

        // Only one open invitation per organisation and e-mail address.
        DB::statement('CREATE UNIQUE INDEX invitations_open_unique ON invitations (organization_id, lower(email)) WHERE accepted_at IS NULL AND revoked_at IS NULL');

        Schema::create('activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('event', 80);
            $table->nullableMorphs('subject');
            // Allows the project activity feed to be queried cheaply.
            $table->unsignedBigInteger('project_id')->nullable()->index();
            // True for administrative audit events (role changes, removals, ...).
            $table->boolean('is_audit')->default(false);
            $table->jsonb('properties')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->index(['organization_id', 'created_at']);
            $table->index(['organization_id', 'is_audit', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('activities');
        Schema::dropIfExists('invitations');
        Schema::dropIfExists('department_user');
        Schema::dropIfExists('departments');
        Schema::dropIfExists('organization_memberships');
        Schema::dropIfExists('organizations');
    }
};
