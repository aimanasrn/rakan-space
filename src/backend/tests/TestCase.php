<?php

namespace Tests;

use App\Enums\Role;
use App\Models\Conversation;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Foundation\Http\Middleware\ValidateCsrfToken;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;

abstract class TestCase extends BaseTestCase
{
    use RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        // Requests come from the SPA origin so Sanctum treats them as stateful.
        $this->withHeaders(['Origin' => 'http://localhost:3000', 'Referer' => 'http://localhost:3000/', 'Accept' => 'application/json']);
        $this->withoutMiddleware(ValidateCsrfToken::class);
    }

    protected function createOrganization(?User $owner = null, string $name = 'Acme Sdn Bhd'): Organization
    {
        $owner ??= User::factory()->create();
        $org = Organization::create([
            'name' => $name,
            'slug' => Organization::uniqueSlug($name),
            'timezone' => 'Asia/Kuala_Lumpur',
            'created_by' => $owner->id,
        ]);
        $this->addMember($org, Role::Owner, $owner);

        return $org;
    }

    protected function addMember(Organization $org, Role $role = Role::Staff, ?User $user = null): User
    {
        $user ??= User::factory()->create();
        OrganizationMembership::create([
            'organization_id' => $org->id,
            'user_id' => $user->id,
            'role' => $role,
            'status' => OrganizationMembership::STATUS_ACTIVE,
            'joined_at' => now(),
        ]);

        return $user;
    }

    protected function owner(Organization $org): User
    {
        return $org->memberships()->where('role', 'owner')->first()->user;
    }

    protected function membership(Organization $org, User $user): OrganizationMembership
    {
        return OrganizationMembership::where('organization_id', $org->id)->where('user_id', $user->id)->firstOrFail();
    }

    /** @param array<User> $members */
    protected function createProject(Organization $org, User $manager, array $members = [], string $visibility = 'restricted'): Project
    {
        $project = $org->projects()->create([
            'name' => 'Project '.fake()->word(),
            'status' => 'active',
            'visibility' => $visibility,
            'manager_id' => $manager->id,
            'created_by' => $manager->id,
        ]);
        $project->memberships()->create(['organization_id' => $org->id, 'user_id' => $manager->id, 'role' => 'manager']);
        foreach ($members as $m) {
            $project->memberships()->create(['organization_id' => $org->id, 'user_id' => $m->id, 'role' => 'member']);
        }

        return $project;
    }

    protected function createTask(Project $project, ?User $assignee = null, array $attrs = []): Task
    {
        return $project->tasks()->create([
            'organization_id' => $project->organization_id,
            'title' => 'Task '.fake()->word(),
            'assignee_id' => $assignee?->id,
            'created_by' => $project->manager_id,
            ...$attrs,
        ]);
    }

    /** @param array<User> $members */
    protected function createChannel(Organization $org, User $creator, array $members = [], string $visibility = 'private', string $name = 'team'): Conversation
    {
        $channel = $org->conversations()->create([
            'type' => 'channel', 'name' => $name.'-'.fake()->unique()->numberBetween(1, 99999), 'visibility' => $visibility, 'created_by' => $creator->id,
        ]);
        $channel->memberships()->create(['user_id' => $creator->id, 'role' => 'admin']);
        foreach ($members as $m) {
            $channel->memberships()->create(['user_id' => $m->id, 'role' => 'member']);
        }

        return $channel;
    }

    protected function api(Organization $org, string $path = ''): string
    {
        return '/api/orgs/'.$org->slug.$path;
    }
}
