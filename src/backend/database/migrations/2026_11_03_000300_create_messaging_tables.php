<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Channels and direct conversations share one table ("conversations") so
 * messaging, read positions and real-time delivery use a single code path.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('conversations', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            // channel | direct
            $table->string('type', 20);
            $table->string('name', 80)->nullable();
            $table->string('topic', 250)->nullable();
            // public | private (direct conversations are always private)
            $table->string('visibility', 20)->default('private');
            // For 1:1 direct conversations: "{lowUserId}:{highUserId}", unique per organisation.
            $table->string('direct_key', 64)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamp('archived_at')->nullable();
            $table->timestamp('last_message_at')->nullable();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->unique(['organization_id', 'direct_key']);
            $table->index(['organization_id', 'type', 'visibility']);
        });

        Schema::create('conversation_members', function (Blueprint $table) {
            $table->id();
            $table->foreignId('conversation_id')->constrained()->cascadeOnDelete();
            $table->foreignId('user_id')->constrained()->cascadeOnDelete();
            // admin | member
            $table->string('role', 20)->default('member');
            $table->unsignedBigInteger('last_read_message_id')->nullable();
            $table->timestamp('joined_at')->nullable();
            $table->timestamps();

            $table->unique(['conversation_id', 'user_id']);
            $table->index('user_id');
        });

        Schema::create('messages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('conversation_id');
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            // Client-generated identifier; a retried send returns the existing message.
            $table->uuid('client_id');
            $table->unsignedBigInteger('parent_id')->nullable();
            $table->text('body')->nullable();
            $table->jsonb('mentions')->nullable();
            $table->timestamp('edited_at')->nullable();
            $table->timestamp('deleted_at')->nullable();
            $table->timestamps();

            $table->foreign(['conversation_id', 'organization_id'])
                ->references(['id', 'organization_id'])->on('conversations')->cascadeOnDelete();
            $table->foreign('parent_id')->references('id')->on('messages')->nullOnDelete();
            $table->unique(['user_id', 'client_id']);
            $table->index(['conversation_id', 'id']);
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('messages');
        Schema::dropIfExists('conversation_members');
        Schema::dropIfExists('conversations');
    }
};
