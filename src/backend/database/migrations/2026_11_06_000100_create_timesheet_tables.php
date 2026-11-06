<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Timesheet. One sheet per member per week (weeks start on Monday). Entries
 * keep a copy of the project and task names, so history survives when a
 * project or task is deleted.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('timesheet_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->unique()->constrained()->cascadeOnDelete();
            // Approval workflow for submitted weeks. Null = create the default one when first needed.
            $table->unsignedBigInteger('workflow_id')->nullable();
            $table->timestamps();
        });
        DB::statement('ALTER TABLE timesheet_settings ADD CONSTRAINT timesheet_settings_workflow_fk FOREIGN KEY (workflow_id, organization_id) REFERENCES approval_workflows (id, organization_id) ON DELETE SET NULL (workflow_id)');

        Schema::create('timesheets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // Monday of the week.
            $table->date('week_start');
            // draft | pending_approval | approved | rejected | returned
            $table->string('status', 20)->default('draft');
            $table->unsignedInteger('total_minutes')->default(0);
            $table->unsignedBigInteger('approval_request_id')->nullable();
            $table->timestamp('submitted_at')->nullable();
            $table->timestamps();

            $table->unique(['organization_id', 'user_id', 'week_start']);
            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'status', 'week_start']);
        });
        DB::statement('ALTER TABLE timesheets ADD CONSTRAINT timesheets_approval_fk FOREIGN KEY (approval_request_id, organization_id) REFERENCES approval_requests (id, organization_id) ON DELETE SET NULL (approval_request_id)');

        Schema::create('timesheet_entries', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('timesheet_id');
            // Null = general (non-project) time.
            $table->unsignedBigInteger('project_id')->nullable();
            $table->unsignedBigInteger('task_id')->nullable();
            $table->string('project_name', 160)->nullable();
            $table->string('task_title', 200)->nullable();
            $table->date('work_date');
            $table->unsignedSmallInteger('minutes');
            $table->string('note', 500)->nullable();
            $table->timestamps();

            $table->foreign(['timesheet_id', 'organization_id'])->references(['id', 'organization_id'])->on('timesheets')->cascadeOnDelete();
            $table->index(['organization_id', 'work_date']);
            $table->index(['organization_id', 'project_id']);
        });
        DB::statement('ALTER TABLE timesheet_entries ADD CONSTRAINT timesheet_entries_project_fk FOREIGN KEY (project_id, organization_id) REFERENCES projects (id, organization_id) ON DELETE SET NULL (project_id)');
        DB::statement('ALTER TABLE timesheet_entries ADD CONSTRAINT timesheet_entries_task_fk FOREIGN KEY (task_id, organization_id) REFERENCES tasks (id, organization_id) ON DELETE SET NULL (task_id)');
        // "One cell per project/task and day" is enforced when saving, not by an index:
        // deleting a project nulls project_id and must never be blocked by it.
        DB::statement('CREATE INDEX timesheet_entries_sheet ON timesheet_entries (timesheet_id, work_date)');
        DB::statement('ALTER TABLE timesheet_entries ADD CONSTRAINT timesheet_entries_minutes_check CHECK (minutes BETWEEN 1 AND 1440)');
    }

    public function down(): void
    {
        Schema::dropIfExists('timesheet_entries');
        Schema::dropIfExists('timesheets');
        Schema::dropIfExists('timesheet_settings');
    }
};
