<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('events', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('title', 200);
            $table->text('description')->nullable();
            $table->string('location', 200)->nullable();
            $table->string('meeting_url', 500)->nullable();
            // Stored in UTC; displayed in the organisation time zone.
            $table->timestampTz('starts_at');
            $table->timestampTz('ends_at');
            // everyone | participants
            $table->string('audience', 20)->default('participants');
            $table->unsignedInteger('reminder_minutes')->nullable()->default(15);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'starts_at']);
        });

        Schema::create('event_participants', function (Blueprint $table) {
            $table->id();
            $table->foreignId('event_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamps();

            $table->unique(['event_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('announcements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('author_id')->nullable()->constrained('users')->nullOnDelete();
            $table->string('title', 200);
            $table->text('body');
            // organization | department
            $table->string('audience', 20)->default('organization');
            $table->unsignedBigInteger('department_id')->nullable();
            $table->boolean('requires_acknowledgement')->default(false);
            $table->timestamp('pinned_at')->nullable();
            $table->timestamps();

            $table->foreign(['department_id', 'organization_id'])
                ->references(['id', 'organization_id'])->on('departments')->restrictOnDelete();
            $table->index(['organization_id', 'pinned_at', 'created_at']);
        });

        Schema::create('announcement_acknowledgements', function (Blueprint $table) {
            $table->id();
            $table->foreignId('announcement_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->timestamp('acknowledged_at');

            $table->unique(['announcement_id', 'user_id']);
        });

        Schema::create('attachments', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->foreignId('uploader_id')->nullable()->constrained('users')->nullOnDelete();
            // Null until linked to a message, task, project or announcement.
            $table->nullableMorphs('attachable');
            $table->string('disk', 40);
            $table->string('path')->unique();
            $table->string('original_name', 255);
            $table->string('extension', 20);
            $table->string('mime_type', 120);
            $table->unsignedBigInteger('size');
            $table->timestamps();

            $table->index(['organization_id', 'created_at']);
        });

        Schema::create('user_notifications', function (Blueprint $table) {
            $table->uuid('id')->primary();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('type', 60);
            $table->string('title', 250);
            $table->string('body', 500)->nullable();
            // Frontend path relative to the workspace, e.g. "/projects/4/tasks/12".
            $table->string('link', 500)->nullable();
            $table->jsonb('data')->nullable();
            // Prevents the same reminder/notification being stored twice.
            $table->string('dedupe_key', 191)->nullable();
            $table->foreignId('actor_id')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('read_at')->nullable();
            $table->timestamp('created_at')->useCurrent();

            $table->unique(['user_id', 'dedupe_key']);
            $table->index(['user_id', 'organization_id', 'read_at']);
            $table->index(['user_id', 'organization_id', 'created_at']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('user_notifications');
        Schema::dropIfExists('attachments');
        Schema::dropIfExists('announcement_acknowledgements');
        Schema::dropIfExists('announcements');
        Schema::dropIfExists('event_participants');
        Schema::dropIfExists('events');
    }
};
