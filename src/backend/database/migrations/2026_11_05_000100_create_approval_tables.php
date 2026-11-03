<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Approval engine. Workflows are templates; each request copies the steps it
 * needs into approval_request_steps (per round), so editing a workflow never
 * changes requests already in progress.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('approval_workflows', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 120);
            $table->string('description', 1000)->nullable();
            $table->boolean('is_active')->default(true);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'is_active']);
        });

        Schema::create('approval_workflow_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('workflow_id');
            $table->unsignedInteger('position');
            $table->string('name', 120);
            // any = first approval completes the step; all = every approver must approve (parallel).
            $table->string('mode', 10)->default('any');
            // [{type: user, user_id}, {type: role, role}, {type: manager}]
            $table->jsonb('approvers');
            // {field, operator, value}: the step only runs when this matches the request data.
            $table->jsonb('condition')->nullable();
            $table->unsignedInteger('sla_hours')->nullable();
            $table->foreignId('escalate_to')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign(['workflow_id', 'organization_id'])->references(['id', 'organization_id'])->on('approval_workflows')->cascadeOnDelete();
            $table->index(['workflow_id', 'position']);
        });

        Schema::create('approval_requests', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('workflow_id')->nullable();
            $table->foreignId('requester_id')->constrained('users')->cascadeOnDelete();
            // What is being approved, e.g. form_submission #12.
            $table->string('entity_type', 60);
            $table->unsignedBigInteger('entity_id')->nullable();
            $table->string('title', 200);
            $table->string('summary', 1000)->nullable();
            // Values used by step conditions and shown to approvers.
            $table->jsonb('data')->nullable();
            // Workspace-relative path to the item, e.g. /apps/form/submissions/12.
            $table->string('link', 500)->nullable();
            // pending | approved | rejected | returned | cancelled
            $table->string('status', 20)->default('pending');
            $table->unsignedInteger('round')->default(1);
            $table->timestamp('submitted_at');
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'status']);
            $table->index(['organization_id', 'requester_id']);
            $table->index(['entity_type', 'entity_id']);
        });
        DB::statement('ALTER TABLE approval_requests ADD CONSTRAINT approval_requests_workflow_fk FOREIGN KEY (workflow_id, organization_id) REFERENCES approval_workflows (id, organization_id) ON DELETE SET NULL (workflow_id)');

        Schema::create('approval_request_steps', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('approval_request_id');
            $table->unsignedInteger('round');
            $table->unsignedInteger('position');
            $table->string('name', 120);
            $table->string('mode', 10);
            $table->jsonb('approvers');
            $table->jsonb('condition')->nullable();
            // waiting | pending | approved | rejected | returned | skipped | cancelled
            $table->string('status', 20)->default('waiting');
            $table->unsignedInteger('sla_hours')->nullable();
            $table->foreignId('escalate_to')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('activated_at')->nullable();
            $table->timestamp('completed_at')->nullable();
            $table->timestamp('reminded_at')->nullable();
            $table->timestamp('escalated_at')->nullable();
            $table->timestamps();

            $table->foreign(['approval_request_id', 'organization_id'])->references(['id', 'organization_id'])->on('approval_requests')->cascadeOnDelete();
            $table->unique(['id', 'organization_id']);
            $table->index(['approval_request_id', 'round', 'position']);
            $table->index(['status', 'activated_at']);
        });

        Schema::create('approval_step_approvers', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('approval_request_id');
            $table->unsignedBigInteger('approval_request_step_id');
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // user | role | manager | fallback | escalation
            $table->string('source', 20);
            // Set when the approver is acting for someone who delegated to them.
            $table->foreignId('delegated_from')->nullable()->constrained('users')->nullOnDelete();
            // null (waiting) | approved | rejected | returned
            $table->string('decision', 20)->nullable();
            $table->text('comment')->nullable();
            $table->timestamp('decided_at')->nullable();
            $table->timestamps();

            $table->foreign(['approval_request_step_id', 'organization_id'])->references(['id', 'organization_id'])->on('approval_request_steps')->cascadeOnDelete();
            $table->foreign(['approval_request_id', 'organization_id'])->references(['id', 'organization_id'])->on('approval_requests')->cascadeOnDelete();
            $table->unique(['approval_request_step_id', 'user_id']);
            $table->index(['organization_id', 'user_id', 'decision']);
        });

        // Full history of a request. Comments are business content, shown to participants only.
        Schema::create('approval_actions', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('approval_request_id');
            $table->unsignedBigInteger('approval_request_step_id')->nullable();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('action', 30);
            $table->text('comment')->nullable();
            $table->jsonb('properties')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->foreign(['approval_request_id', 'organization_id'])->references(['id', 'organization_id'])->on('approval_requests')->cascadeOnDelete();
            $table->index(['approval_request_id', 'id']);
        });

        Schema::create('approval_delegations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('delegator_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('delegate_id')->constrained('users')->cascadeOnDelete();
            $table->timestamp('starts_at');
            $table->timestamp('ends_at');
            $table->string('reason', 255)->nullable();
            $table->timestamp('revoked_at')->nullable();
            $table->timestamps();

            $table->foreign(['organization_id', 'delegator_id'])->references(['organization_id', 'user_id'])->on('organization_memberships')->cascadeOnDelete();
            $table->foreign(['organization_id', 'delegate_id'])->references(['organization_id', 'user_id'])->on('organization_memberships')->cascadeOnDelete();
            $table->index(['organization_id', 'delegator_id', 'starts_at', 'ends_at']);
        });
        DB::statement('ALTER TABLE approval_delegations ADD CONSTRAINT approval_delegations_not_self CHECK (delegator_id <> delegate_id)');
        DB::statement('ALTER TABLE approval_delegations ADD CONSTRAINT approval_delegations_range CHECK (ends_at > starts_at)');
    }

    public function down(): void
    {
        Schema::dropIfExists('approval_delegations');
        Schema::dropIfExists('approval_actions');
        Schema::dropIfExists('approval_step_approvers');
        Schema::dropIfExists('approval_request_steps');
        Schema::dropIfExists('approval_requests');
        Schema::dropIfExists('approval_workflow_steps');
        Schema::dropIfExists('approval_workflows');
    }
};
