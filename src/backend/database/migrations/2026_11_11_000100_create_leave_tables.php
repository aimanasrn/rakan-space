<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Leave. Each organisation has its own leave types (created from defaults the
 * first time the app is used) with a yearly entitlement. Admins can give a
 * member a different entitlement for a year. Applications count working days
 * (Monday to Friday) and go through an approval workflow.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('leave_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->unique()->constrained()->cascadeOnDelete();
            // Approval workflow for applications. Null = create the default one when first needed.
            $table->unsignedBigInteger('workflow_id')->nullable();
            $table->timestamps();
        });
        DB::statement('ALTER TABLE leave_settings ADD CONSTRAINT leave_settings_workflow_fk FOREIGN KEY (workflow_id, organization_id) REFERENCES approval_workflows (id, organization_id) ON DELETE SET NULL (workflow_id)');

        Schema::create('leave_types', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('key', 40);
            $table->string('name', 80);
            $table->string('color', 7);
            // Days per calendar year. Null = no limit (e.g. business travel).
            $table->decimal('entitlement_days', 5, 1)->nullable();
            $table->boolean('is_active')->default(true);
            $table->unsignedSmallInteger('position')->default(0);
            $table->timestamps();

            $table->unique(['organization_id', 'key']);
            $table->unique(['id', 'organization_id']);
        });

        Schema::create('leave_entitlements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('leave_type_id');
            $table->unsignedSmallInteger('year');
            $table->decimal('days', 5, 1);
            $table->timestamps();

            $table->foreign(['leave_type_id', 'organization_id'])->references(['id', 'organization_id'])->on('leave_types')->cascadeOnDelete();
            $table->unique(['organization_id', 'user_id', 'leave_type_id', 'year']);
        });

        Schema::create('leave_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('leave_type_id');
            $table->date('start_date');
            $table->date('end_date');
            // none | am | pm (half days are single-day applications only)
            $table->string('half_day', 4)->default('none');
            $table->decimal('days', 5, 1);
            $table->text('reason')->nullable();
            // pending_approval | approved | rejected | returned | cancelled
            $table->string('status', 20)->default('pending_approval');
            $table->unsignedBigInteger('approval_request_id')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamp('cancelled_at')->nullable();
            $table->timestamps();

            $table->foreign(['leave_type_id', 'organization_id'])->references(['id', 'organization_id'])->on('leave_types');
            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'start_date', 'end_date']);
            $table->index(['organization_id', 'user_id', 'status']);
        });
        DB::statement('ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_approval_fk FOREIGN KEY (approval_request_id, organization_id) REFERENCES approval_requests (id, organization_id) ON DELETE SET NULL (approval_request_id)');
        DB::statement('ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_dates_check CHECK (end_date >= start_date)');
        DB::statement('ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_days_check CHECK (days > 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('leave_requests');
        Schema::dropIfExists('leave_entitlements');
        Schema::dropIfExists('leave_types');
        Schema::dropIfExists('leave_settings');
    }
};
