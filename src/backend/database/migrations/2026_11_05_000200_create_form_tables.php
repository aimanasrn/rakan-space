<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Form builder. A form has at most one draft version (published_at null) that
 * the builder edits; publishing freezes it. Submissions point at the version
 * they were filled against, so later edits never change old answers.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('forms', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('description', 2000)->nullable();
            // draft (never published) | published | closed
            $table->string('status', 20)->default('draft');
            $table->unsignedBigInteger('current_version_id')->nullable();
            // Who may fill it: {roles: [...], department_ids: [...]}; empty = every member.
            $table->jsonb('audience')->nullable();
            $table->unsignedBigInteger('workflow_id')->nullable();
            $table->boolean('allow_multiple')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('published_at')->nullable();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'status']);
        });
        DB::statement('ALTER TABLE forms ADD CONSTRAINT forms_workflow_fk FOREIGN KEY (workflow_id, organization_id) REFERENCES approval_workflows (id, organization_id) ON DELETE SET NULL (workflow_id)');

        Schema::create('form_versions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('form_id');
            $table->unsignedInteger('version');
            $table->timestamp('published_at')->nullable();
            $table->foreignId('published_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign(['form_id', 'organization_id'])->references(['id', 'organization_id'])->on('forms')->cascadeOnDelete();
            $table->unique(['form_id', 'version']);
            $table->unique(['id', 'organization_id']);
        });
        // At most one draft per form.
        DB::statement('CREATE UNIQUE INDEX form_versions_one_draft ON form_versions (form_id) WHERE published_at IS NULL');
        DB::statement('ALTER TABLE forms ADD CONSTRAINT forms_current_version_fk FOREIGN KEY (current_version_id) REFERENCES form_versions (id) ON DELETE SET NULL');

        Schema::create('form_fields', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('form_version_id');
            $table->string('key', 60);
            $table->string('type', 20);
            $table->string('label', 200);
            $table->string('help_text', 500)->nullable();
            $table->boolean('required')->default(false);
            $table->unsignedInteger('position');
            // Choices for dropdown/radio/checkbox; columns for table.
            $table->jsonb('options')->nullable();
            // min, max, min_length, max_length, max_files, max_rows
            $table->jsonb('validation')->nullable();
            // {field, operator, value}: show the field only when this matches.
            $table->jsonb('visibility')->nullable();
            $table->timestamps();

            $table->foreign(['form_version_id', 'organization_id'])->references(['id', 'organization_id'])->on('form_versions')->cascadeOnDelete();
            $table->unique(['form_version_id', 'key']);
        });

        Schema::create('form_submissions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('form_id');
            $table->unsignedBigInteger('form_version_id');
            $table->foreignId('submitter_id')->constrained('users')->cascadeOnDelete();
            // submitted | pending_approval | approved | rejected | returned | withdrawn
            $table->string('status', 20);
            $table->unsignedBigInteger('approval_request_id')->nullable();
            $table->timestamp('submitted_at');
            $table->timestamps();

            $table->foreign(['form_id', 'organization_id'])->references(['id', 'organization_id'])->on('forms')->cascadeOnDelete();
            $table->foreign(['form_version_id', 'organization_id'])->references(['id', 'organization_id'])->on('form_versions');
            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'submitter_id']);
            $table->index(['form_id', 'status']);
        });
        DB::statement('ALTER TABLE form_submissions ADD CONSTRAINT form_submissions_approval_fk FOREIGN KEY (approval_request_id, organization_id) REFERENCES approval_requests (id, organization_id) ON DELETE SET NULL (approval_request_id)');

        Schema::create('form_submission_values', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('form_submission_id');
            $table->string('field_key', 60);
            $table->jsonb('value')->nullable();
            $table->timestamps();

            $table->foreign(['form_submission_id', 'organization_id'])->references(['id', 'organization_id'])->on('form_submissions')->cascadeOnDelete();
            $table->unique(['form_submission_id', 'field_key']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('form_submission_values');
        Schema::dropIfExists('form_submissions');
        Schema::dropIfExists('form_fields');
        DB::statement('ALTER TABLE IF EXISTS forms DROP CONSTRAINT IF EXISTS forms_current_version_fk');
        Schema::dropIfExists('form_versions');
        Schema::dropIfExists('forms');
    }
};
