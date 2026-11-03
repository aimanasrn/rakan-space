<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('projects', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->text('description')->nullable();
            // planning | active | on_hold | completed
            $table->string('status', 20)->default('planning');
            // organization (all members can view) | restricted (project members only)
            $table->string('visibility', 20)->default('restricted');
            $table->foreignId('manager_id')->nullable()->constrained('users')->nullOnDelete();
            $table->date('start_date')->nullable();
            $table->date('target_date')->nullable();
            $table->timestamp('archived_at')->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'archived_at', 'status']);
        });

        Schema::create('project_members', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('project_id');
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // manager | member
            $table->string('role', 20)->default('member');
            $table->timestamps();

            $table->foreign(['project_id', 'organization_id'])
                ->references(['id', 'organization_id'])->on('projects')->cascadeOnDelete();
            $table->unique(['project_id', 'user_id']);
            $table->index(['organization_id', 'user_id']);
        });

        Schema::create('tasks', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('project_id');
            $table->string('title', 200);
            $table->text('description')->nullable();
            // todo | in_progress | in_review | done
            $table->string('status', 20)->default('todo');
            // low | medium | high | urgent
            $table->string('priority', 20)->default('medium');
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            // Date-only deadline: stored without time so it never shifts across days.
            $table->date('due_date')->nullable();
            $table->integer('position')->default(0);
            $table->timestamp('completed_at')->nullable();
            $table->timestamps();

            $table->foreign(['project_id', 'organization_id'])
                ->references(['id', 'organization_id'])->on('projects')->cascadeOnDelete();
            $table->unique(['id', 'organization_id']);
            $table->index(['project_id', 'status', 'position']);
            $table->index(['organization_id', 'assignee_id', 'status']);
            $table->index(['organization_id', 'due_date']);
        });

        Schema::create('task_checklist_items', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->string('body', 300);
            $table->boolean('is_done')->default(false);
            $table->integer('position')->default(0);
            $table->timestamps();
        });

        Schema::create('task_comments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('task_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->text('body');
            $table->timestamp('edited_at')->nullable();
            $table->timestamps();

            $table->index(['task_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('task_comments');
        Schema::dropIfExists('task_checklist_items');
        Schema::dropIfExists('tasks');
        Schema::dropIfExists('project_members');
        Schema::dropIfExists('projects');
    }
};
