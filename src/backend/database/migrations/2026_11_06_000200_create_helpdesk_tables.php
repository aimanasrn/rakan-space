<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Helpdesk: an internal service desk. Members raise tickets; agents (chosen
 * people, plus anyone whose role has the Helpdesk "edit" ability) work them.
 * SLA due times are stored on the ticket when it is created or re-prioritised.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('helpdesk_settings', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->unique()->constrained()->cascadeOnDelete();
            // {priority: {first_response_hours, resolution_hours}}
            $table->jsonb('sla')->nullable();
            // Ticket categories offered when raising a ticket.
            $table->jsonb('categories')->nullable();
            // Resolved tickets close after this many days without a reply (0 = never).
            $table->unsignedSmallInteger('auto_close_days')->default(7);
            $table->timestamps();
        });

        Schema::create('helpdesk_agents', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['organization_id', 'user_id']);
        });

        Schema::create('helpdesk_tickets', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('subject', 200);
            $table->text('description');
            // open | in_progress | waiting | resolved | closed
            $table->string('status', 20)->default('open');
            // low | medium | high | urgent
            $table->string('priority', 10)->default('medium');
            $table->string('category', 60)->nullable();
            $table->foreignId('requester_id')->constrained('users')->cascadeOnDelete();
            $table->foreignId('assignee_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('first_response_due_at')->nullable();
            $table->timestamp('resolution_due_at')->nullable();
            $table->timestamp('first_responded_at')->nullable();
            $table->timestamp('resolved_at')->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->timestamp('last_activity_at')->nullable();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'status', 'priority']);
            $table->index(['organization_id', 'assignee_id', 'status']);
            $table->index(['organization_id', 'requester_id']);
        });

        Schema::create('helpdesk_messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('ticket_id');
            $table->foreignId('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->text('body');
            // Internal notes are visible to agents only.
            $table->boolean('is_internal')->default(false);
            $table->timestamps();

            $table->foreign(['ticket_id', 'organization_id'])->references(['id', 'organization_id'])->on('helpdesk_tickets')->cascadeOnDelete();
            $table->unique(['id', 'organization_id']);
            $table->index(['ticket_id', 'id']);
        });

        Schema::create('helpdesk_canned_responses', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('title', 120);
            $table->text('body');
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->index(['organization_id', 'title']);
        });
        DB::statement("ALTER TABLE helpdesk_tickets ADD CONSTRAINT helpdesk_tickets_status_check CHECK (status IN ('open', 'in_progress', 'waiting', 'resolved', 'closed'))");
        DB::statement("ALTER TABLE helpdesk_tickets ADD CONSTRAINT helpdesk_tickets_priority_check CHECK (priority IN ('low', 'medium', 'high', 'urgent'))");
    }

    public function down(): void
    {
        Schema::dropIfExists('helpdesk_canned_responses');
        Schema::dropIfExists('helpdesk_messages');
        Schema::dropIfExists('helpdesk_tickets');
        Schema::dropIfExists('helpdesk_agents');
        Schema::dropIfExists('helpdesk_settings');
    }
};
