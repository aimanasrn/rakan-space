<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Opportunity app (CRM). Accounts and contacts are a shared customer
 * directory; opportunities move through the organisation's pipeline stages.
 * Every child row carries organization_id and composite foreign keys, so a
 * row can never point at another organisation's data.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('crm_stages', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 60);
            $table->unsignedInteger('position');
            $table->unsignedTinyInteger('probability')->default(0);
            // open | won | lost
            $table->string('kind', 10)->default('open');
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'position']);
        });

        Schema::create('crm_accounts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 160);
            $table->string('industry', 80)->nullable();
            $table->string('website', 255)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('address', 500)->nullable();
            $table->text('notes')->nullable();
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'name']);
        });

        Schema::create('crm_contacts', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('account_id')->nullable();
            $table->string('name', 160);
            $table->string('email', 255)->nullable();
            $table->string('phone', 40)->nullable();
            $table->string('job_title', 120)->nullable();
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'name']);
        });
        DB::statement('ALTER TABLE crm_contacts ADD CONSTRAINT crm_contacts_account_fk FOREIGN KEY (account_id, organization_id) REFERENCES crm_accounts (id, organization_id) ON DELETE SET NULL (account_id)');

        Schema::create('crm_opportunities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->string('name', 200);
            $table->unsignedBigInteger('account_id')->nullable();
            $table->unsignedBigInteger('contact_id')->nullable();
            $table->unsignedBigInteger('stage_id');
            $table->foreignId('owner_id')->nullable()->constrained('users')->nullOnDelete();
            $table->decimal('amount', 14, 2)->default(0);
            $table->date('expected_close_date')->nullable();
            $table->text('description')->nullable();
            $table->string('lost_reason', 300)->nullable();
            $table->timestamp('closed_at')->nullable();
            $table->integer('position')->default(0);
            $table->foreignId('created_by')->nullable()->constrained('users')->nullOnDelete();
            $table->timestamps();

            $table->foreign(['stage_id', 'organization_id'])->references(['id', 'organization_id'])->on('crm_stages');
            $table->unique(['id', 'organization_id']);
            $table->index(['organization_id', 'stage_id', 'position']);
            $table->index(['organization_id', 'owner_id']);
            $table->index(['organization_id', 'expected_close_date']);
        });
        DB::statement('ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_account_fk FOREIGN KEY (account_id, organization_id) REFERENCES crm_accounts (id, organization_id) ON DELETE SET NULL (account_id)');
        DB::statement('ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_contact_fk FOREIGN KEY (contact_id, organization_id) REFERENCES crm_contacts (id, organization_id) ON DELETE SET NULL (contact_id)');

        Schema::create('crm_activities', function (Blueprint $table) {
            $table->id();
            $table->foreignId('organization_id')->constrained()->cascadeOnDelete();
            $table->unsignedBigInteger('opportunity_id')->nullable();
            $table->unsignedBigInteger('account_id')->nullable();
            // note | call | meeting | email | task
            $table->string('type', 10);
            $table->string('subject', 200);
            $table->text('body')->nullable();
            // Tasks: when it is due and when it was done.
            $table->timestamp('due_at')->nullable();
            $table->timestamp('done_at')->nullable();
            $table->foreignId('user_id')->nullable()->constrained()->nullOnDelete();
            $table->timestamps();

            $table->foreign(['opportunity_id', 'organization_id'])->references(['id', 'organization_id'])->on('crm_opportunities')->cascadeOnDelete();
            $table->foreign(['account_id', 'organization_id'])->references(['id', 'organization_id'])->on('crm_accounts')->cascadeOnDelete();
            $table->index(['organization_id', 'opportunity_id']);
            $table->index(['organization_id', 'account_id']);
            $table->index(['organization_id', 'user_id', 'done_at']);
        });
        DB::statement("ALTER TABLE crm_stages ADD CONSTRAINT crm_stages_kind_check CHECK (kind IN ('open', 'won', 'lost'))");
        DB::statement('ALTER TABLE crm_stages ADD CONSTRAINT crm_stages_probability_check CHECK (probability BETWEEN 0 AND 100)');
        DB::statement('ALTER TABLE crm_opportunities ADD CONSTRAINT crm_opportunities_amount_check CHECK (amount >= 0)');
    }

    public function down(): void
    {
        Schema::dropIfExists('crm_activities');
        Schema::dropIfExists('crm_opportunities');
        Schema::dropIfExists('crm_contacts');
        Schema::dropIfExists('crm_accounts');
        Schema::dropIfExists('crm_stages');
    }
};
