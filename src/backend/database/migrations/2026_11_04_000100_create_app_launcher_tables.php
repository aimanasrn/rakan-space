<?php

use App\Support\AppCatalog;
use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        // Global catalogue of apps (synced from App\Support\AppCatalog).
        Schema::create('apps', function (Blueprint $table) {
            $table->id();
            $table->string('key', 40)->unique();
            $table->string('name', 80);
            $table->string('tagline', 160);
            $table->text('description');
            $table->string('icon', 40);
            $table->string('gradient_from', 9);
            $table->string('gradient_to', 9);
            $table->string('category', 40);
            $table->boolean('is_default')->default(false);
            $table->unsignedInteger('sort_order')->default(0);
            $table->timestamps();
        });

        // Apps installed for a whole organisation.
        Schema::create('organization_apps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('app_id')->constrained()->cascadeOnDelete();
            $table->foreignId('installed_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('installed_at');
            $table->timestamps();

            $table->unique(['organization_id', 'app_id']);
        });

        // Per-user shortcuts. The membership FK keeps pins inside the user's own organisation.
        Schema::create('user_app_pins', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('app_id')->constrained()->cascadeOnDelete();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['organization_id', 'user_id'])
                ->references(['organization_id', 'user_id'])->on('organization_memberships')->cascadeOnDelete();
            $table->unique(['organization_id', 'user_id', 'app_id']);
        });

        // Organisation overrides of the default abilities per role (manager, staff).
        Schema::create('app_role_permissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('app_id')->constrained()->cascadeOnDelete();
            $table->string('role', 20);
            $table->jsonb('abilities');
            $table->timestamps();

            $table->unique(['organization_id', 'app_id', 'role']);
        });

        // Members asking an admin to install a marketplace app.
        Schema::create('app_access_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('app_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // pending | approved | rejected
            $table->string('status', 20)->default('pending');
            $table->string('note', 500)->nullable();
            $table->foreignId('decided_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->foreign(['organization_id', 'user_id'])
                ->references(['organization_id', 'user_id'])->on('organization_memberships')->cascadeOnDelete();
            $table->index(['organization_id', 'status']);
        });
        DB::statement("CREATE UNIQUE INDEX app_access_requests_pending_unique ON app_access_requests (organization_id, app_id, user_id) WHERE status = 'pending'");

        Schema::create('launcher_banners', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120);
            $table->string('description', 500)->nullable();
            $table->string('cta_label', 40)->nullable();
            $table->string('cta_url', 2048)->nullable();
            $table->string('image_path')->nullable();
            // Built-in illustration used when no image is uploaded.
            $table->string('illustration', 40)->nullable();
            $table->boolean('is_active')->default(true);
            $table->integer('sort_order')->default(0);
            $table->timestampTz('starts_at')->nullable();
            $table->timestampTz('ends_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'is_active', 'sort_order']);
        });

        AppCatalog::sync();
    }

    public function down(): void
    {
        Schema::dropIfExists('launcher_banners');
        Schema::dropIfExists('app_access_requests');
        Schema::dropIfExists('app_role_permissions');
        Schema::dropIfExists('user_app_pins');
        Schema::dropIfExists('organization_apps');
        Schema::dropIfExists('apps');
    }
};
