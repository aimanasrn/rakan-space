<?php

namespace App\Http\Controllers;

use App\Enums\ProjectStatus;
use App\Enums\Role;
use App\Http\Resources\ActivityResource;
use App\Http\Resources\ProjectResource;
use App\Models\Attachment;
use App\Models\Organization;
use App\Models\Project;
use App\Support\ActivityLog;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class ProjectController extends Controller
{
    public static function withProgress(Builder $query): Builder
    {
        $today = now()->toDateString();

        return $query->withCount([
            'tasks',
            'tasks as done_tasks_count' => fn ($q) => $q->where('status', 'done'),
            'tasks as overdue_tasks_count' => fn ($q) => $q->where('status', '!=', 'done')->whereNotNull('due_date')->where('due_date', '<', $today),
        ]);
    }

    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(ProjectStatus::values())],
            'archived' => ['nullable', Rule::in(['0', '1', 'true', 'false'])],
            'mine' => ['nullable', Rule::in(['0', '1', 'true', 'false'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();

        $query = Permissions::visibleProjectsQuery($user, $organization->id)
            ->with(['manager', 'memberships'])
            ->withCount('memberships')
            ->when($request->boolean('archived'), fn ($q) => $q->whereNotNull('archived_at'), fn ($q) => $q->whereNull('archived_at'))
            ->when($request->filled('status'), fn ($q) => $q->where('status', $request->input('status')))
            ->when($request->boolean('mine'), fn ($q) => $q->whereHas('memberships', fn ($m) => $m->where('user_id', $user->id)))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('name', 'ilike', $term)->orWhere('description', 'ilike', $term));
            })
            ->orderByRaw("CASE status WHEN 'active' THEN 0 WHEN 'planning' THEN 1 WHEN 'on_hold' THEN 2 ELSE 3 END")
            ->orderBy('target_date')
            ->orderBy('name');

        return ProjectResource::collection(self::withProgress($query)->paginate($request->integer('per_page', 24)));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::hasRole($request->user(), $organization->id, Role::Manager), 403, 'Only managers, admins and owners can create projects.');
        $data = $this->validated($request);
        $user = $request->user();

        $managerId = $data['manager_id'] ?? $user->id;
        $memberIds = collect($data['member_ids'] ?? [])->push($managerId)->push($user->id)->unique()->values()->all();
        $activeIds = $organization->filterActiveMemberIds($memberIds);
        abort_if(count($activeIds) !== count($memberIds), 422, 'Project members must be active members of this workspace.');

        $project = DB::transaction(function () use ($organization, $data, $user, $managerId, $activeIds) {
            $project = $organization->projects()->create([
                ...collect($data)->except(['member_ids'])->all(),
                'manager_id' => $managerId,
                'status' => $data['status'] ?? ProjectStatus::Planning->value,
                'visibility' => $data['visibility'] ?? Project::VISIBILITY_RESTRICTED,
                'created_by' => $user->id,
            ]);

            foreach ($activeIds as $id) {
                $project->memberships()->create([
                    'organization_id' => $organization->id,
                    'user_id' => $id,
                    'role' => $id === $managerId ? 'manager' : 'member',
                ]);
            }

            ActivityLog::record($organization->id, $user, 'project.created', $project, ['name' => $project->name], $project->id);

            return $project;
        });

        Notifier::send($organization->id, $activeIds, 'project.added', 'You were added to project '.$project->name,
            null, '/projects/'.$project->id, $user->id, 'project-added:'.$project->id);

        return (new ProjectResource($this->loadForShow($project)))->response()->setStatusCode(201);
    }

    public function show(Request $request, Organization $organization, Project $project): ProjectResource
    {
        $this->authorizeView($request, $project);

        return new ProjectResource($this->loadForShow($project));
    }

    public function update(Request $request, Organization $organization, Project $project): ProjectResource
    {
        $this->authorizeManage($request, $project);
        $data = $this->validated($request, true);

        DB::transaction(function () use ($organization, $project, $data, $request) {
            if (array_key_exists('manager_id', $data) && $data['manager_id'] !== null) {
                abort_unless($organization->hasActiveMember($data['manager_id']), 422, 'The project manager must be an active member.');
                $project->memberships()->updateOrCreate(
                    ['user_id' => $data['manager_id']],
                    ['organization_id' => $organization->id, 'role' => 'manager'],
                );
            }

            $project->fill(collect($data)->except('member_ids')->all());
            $changes = array_keys($project->getDirty());
            $project->save();

            if ($changes) {
                ActivityLog::record($organization->id, $request->user(), 'project.updated', $project, ['fields' => $changes], $project->id);
            }
        });

        return new ProjectResource($this->loadForShow($project->fresh()));
    }

    public function archive(Request $request, Organization $organization, Project $project): ProjectResource
    {
        $this->authorizeManage($request, $project);
        $project->update(['archived_at' => now()]);
        ActivityLog::record($organization->id, $request->user(), 'project.archived', $project, [], $project->id);

        return new ProjectResource($this->loadForShow($project));
    }

    public function unarchive(Request $request, Organization $organization, Project $project): ProjectResource
    {
        $this->authorizeManage($request, $project);
        $project->update(['archived_at' => null]);
        ActivityLog::record($organization->id, $request->user(), 'project.unarchived', $project, [], $project->id);

        return new ProjectResource($this->loadForShow($project));
    }

    public function destroy(Request $request, Organization $organization, Project $project): JsonResponse
    {
        abort_unless(Permissions::isAdmin($request->user(), $organization->id), 403, 'Only owners and admins can delete projects. Archive it instead.');

        DB::transaction(function () use ($project, $organization, $request) {
            $taskIds = $project->tasks()->pluck('id');
            Attachment::where('attachable_type', 'task')->whereIn('attachable_id', $taskIds)->update(['attachable_type' => null, 'attachable_id' => null]);
            $project->attachments()->update(['attachable_type' => null, 'attachable_id' => null]);
            $project->delete();
            ActivityLog::audit($organization->id, $request->user(), 'project.deleted', null, ['name' => $project->name]);
        });

        return response()->json(['message' => 'Project deleted.']);
    }

    /** Replace project members. Body: members: [{user_id, role: manager|member}] */
    public function syncMembers(Request $request, Organization $organization, Project $project): ProjectResource
    {
        $this->authorizeManage($request, $project);
        $data = $request->validate([
            'members' => ['present', 'array', 'max:500'],
            'members.*.user_id' => ['required', 'integer', 'distinct'],
            'members.*.role' => ['required', Rule::in(['manager', 'member'])],
        ]);

        $members = collect($data['members']);
        if ($project->manager_id && ! $members->contains('user_id', $project->manager_id)) {
            $members->push(['user_id' => $project->manager_id, 'role' => 'manager']);
        }

        $ids = $members->pluck('user_id')->all();
        abort_if(count($organization->filterActiveMemberIds($ids)) !== count($ids), 422, 'Project members must be active members of this workspace.');

        $added = DB::transaction(function () use ($project, $members, $organization, $request) {
            $existing = $project->memberships()->pluck('user_id')->all();
            $newIds = $members->pluck('user_id')->all();
            $removed = array_diff($existing, $newIds);

            $project->memberships()->whereIn('user_id', $removed)->delete();
            foreach ($members as $m) {
                $project->memberships()->updateOrCreate(
                    ['user_id' => $m['user_id']],
                    ['organization_id' => $organization->id, 'role' => $m['user_id'] === $project->manager_id ? 'manager' : $m['role']],
                );
            }

            // People removed from the project no longer hold its open tasks.
            if ($removed) {
                $project->tasks()->whereIn('assignee_id', $removed)->where('status', '!=', 'done')->update(['assignee_id' => null]);
            }

            ActivityLog::record($organization->id, $request->user(), 'project.members_updated', $project, [
                'added' => count(array_diff($newIds, $existing)), 'removed' => count($removed),
            ], $project->id);

            return array_values(array_diff($newIds, $existing));
        });

        if ($added) {
            Notifier::send($organization->id, $added, 'project.added', 'You were added to project '.$project->name,
                null, '/projects/'.$project->id, $request->user()->id, 'project-added:'.$project->id);
        }

        return new ProjectResource($this->loadForShow($project));
    }

    public function activity(Request $request, Organization $organization, Project $project): AnonymousResourceCollection
    {
        $this->authorizeView($request, $project);

        return ActivityResource::collection(
            $organization->activities()->with('actor')->where('project_id', $project->id)->latest('id')->paginate(30)
        );
    }

    private function loadForShow(Project $project): Project
    {
        $project->load(['manager', 'memberships.user'])->loadCount('memberships');
        $fresh = self::withProgress(Project::whereKey($project->id))->first();
        foreach (['tasks_count', 'done_tasks_count', 'overdue_tasks_count'] as $attr) {
            $project->setAttribute($attr, $fresh->{$attr});
        }

        return $project;
    }

    private function validated(Request $request, bool $updating = false): array
    {
        $req = $updating ? 'sometimes' : 'required';

        return $request->validate([
            'name' => [$req, 'string', 'max:160'],
            'description' => ['nullable', 'string', 'max:5000'],
            'status' => ['sometimes', Rule::in(ProjectStatus::values())],
            'visibility' => ['sometimes', Rule::in([Project::VISIBILITY_ORGANIZATION, Project::VISIBILITY_RESTRICTED])],
            'manager_id' => ['nullable', 'integer'],
            'start_date' => ['nullable', 'date_format:Y-m-d'],
            'target_date' => ['nullable', 'date_format:Y-m-d', 'after_or_equal:start_date'],
            'member_ids' => [$updating ? 'prohibited' : 'sometimes', 'array', 'max:500'],
            'member_ids.*' => ['integer'],
        ]);
    }

    private function authorizeView(Request $request, Project $project): void
    {
        // 404 rather than 403 so restricted projects are not revealed.
        abort_unless(Permissions::canViewProject($request->user(), $project), 404);
    }

    private function authorizeManage(Request $request, Project $project): void
    {
        $this->authorizeView($request, $project);
        abort_unless(Permissions::canManageProject($request->user(), $project), 403, 'Only project managers can do this.');
    }
}
