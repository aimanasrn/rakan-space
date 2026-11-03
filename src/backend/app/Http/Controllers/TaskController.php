<?php

namespace App\Http\Controllers;

use App\Enums\TaskPriority;
use App\Enums\TaskStatus;
use App\Http\Resources\ActivityResource;
use App\Http\Resources\TaskResource;
use App\Models\Organization;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskChecklistItem;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Attachments;
use App\Support\Notifier;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class TaskController extends Controller
{
    /** Organisation-wide task list ("My Tasks", project lists, Kanban). */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'project_id' => ['nullable', 'integer'],
            'assignee' => ['nullable', 'string', 'max:20'],
            'status' => ['nullable', 'string', 'max:100'],
            'priority' => ['nullable', 'string', 'max:100'],
            'q' => ['nullable', 'string', 'max:100'],
            'due' => ['nullable', Rule::in(['overdue', 'today', 'week', 'none', 'upcoming'])],
            'sort' => ['nullable', Rule::in(['due_date', 'priority', 'created_at', 'updated_at', 'position', 'title'])],
            'direction' => ['nullable', Rule::in(['asc', 'desc'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:500'],
        ]);

        $user = $request->user();
        $today = $this->today($organization);
        $visibleProjects = Permissions::visibleProjectsQuery($user, $organization->id)
            ->when(! $request->filled('project_id'), fn ($q) => $q->whereNull('archived_at'))
            ->select('id');

        $query = $organization->tasks()
            ->whereIn('project_id', $visibleProjects)
            ->with(['assignee', 'project.memberships'])
            ->withCount(['checklistItems', 'comments', 'checklistItems as checklist_done_count' => fn ($q) => $q->where('is_done', true)])
            ->when($request->filled('project_id'), fn ($q) => $q->where('project_id', $request->integer('project_id')))
            ->when($request->input('assignee') === 'me', fn ($q) => $q->where('assignee_id', $user->id))
            ->when($request->input('assignee') === 'unassigned', fn ($q) => $q->whereNull('assignee_id'))
            ->when(ctype_digit((string) $request->input('assignee')), fn ($q) => $q->where('assignee_id', (int) $request->input('assignee')))
            ->when($request->filled('status'), fn ($q) => $q->whereIn('status', array_intersect(explode(',', $request->input('status')), TaskStatus::values())))
            ->when($request->filled('priority'), fn ($q) => $q->whereIn('priority', array_intersect(explode(',', $request->input('priority')), TaskPriority::values())))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('title', 'ilike', $term)->orWhere('description', 'ilike', $term));
            })
            ->when($request->input('due') === 'overdue', fn ($q) => $q->where('status', '!=', 'done')->where('due_date', '<', $today))
            ->when($request->input('due') === 'today', fn ($q) => $q->where('due_date', $today))
            ->when($request->input('due') === 'week', fn ($q) => $q->whereBetween('due_date', [$today, now($organization->timezone)->addDays(7)->toDateString()]))
            ->when($request->input('due') === 'upcoming', fn ($q) => $q->where('status', '!=', 'done')->where('due_date', '>=', $today))
            ->when($request->input('due') === 'none', fn ($q) => $q->whereNull('due_date'));

        $direction = $request->input('direction', 'asc');
        match ($request->input('sort', 'due_date')) {
            'priority' => $query->orderByRaw("CASE priority WHEN 'urgent' THEN 4 WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END ".($direction === 'asc' ? 'DESC' : 'ASC')),
            'due_date' => $query->orderByRaw('due_date '.$direction.' NULLS LAST'),
            default => $query->orderBy($request->input('sort'), $direction),
        };
        $query->orderBy('position')->orderBy('id');

        return TaskResource::collection($query->paginate($request->integer('per_page', 50)));
    }

    public function store(Request $request, Organization $organization, Project $project): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewProject($user, $project), 404);
        abort_unless(Permissions::canContributeToProject($user, $project), 403, 'Only project members can add tasks.');

        $data = $request->validate([
            'title' => ['required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:10000'],
            'status' => ['sometimes', Rule::in(TaskStatus::values())],
            'priority' => ['sometimes', Rule::in(TaskPriority::values())],
            'assignee_id' => ['nullable', 'integer'],
            'due_date' => ['nullable', 'date_format:Y-m-d'],
            'checklist' => ['sometimes', 'array', 'max:50'],
            'checklist.*' => ['string', 'max:300'],
            'attachment_ids' => ['sometimes', 'array', 'max:10'],
            'attachment_ids.*' => ['integer'],
        ]);

        $this->ensureEligibleAssignee($project, $data['assignee_id'] ?? null);

        $task = DB::transaction(function () use ($organization, $project, $data, $user) {
            $status = $data['status'] ?? TaskStatus::Todo->value;
            $task = $project->tasks()->create([
                'organization_id' => $organization->id,
                'title' => $data['title'],
                'description' => $data['description'] ?? null,
                'status' => $status,
                'priority' => $data['priority'] ?? TaskPriority::Medium->value,
                'assignee_id' => $data['assignee_id'] ?? null,
                'due_date' => $data['due_date'] ?? null,
                'created_by' => $user->id,
                'position' => (int) $project->tasks()->where('status', $status)->max('position') + 1,
                'completed_at' => $status === 'done' ? now() : null,
            ]);

            foreach (array_values($data['checklist'] ?? []) as $i => $body) {
                $task->checklistItems()->create(['body' => $body, 'position' => $i]);
            }

            Attachments::attach($user, $organization, $data['attachment_ids'] ?? [], $task);

            ActivityLog::record($organization->id, $user, 'task.created', $task, ['title' => $task->title], $project->id);

            return $task;
        });

        if ($task->assignee_id) {
            $this->notifyAssigned($organization, $task, $user);
        }

        return (new TaskResource($this->loadForShow($task)))->response()->setStatusCode(201);
    }

    public function show(Request $request, Organization $organization, Task $task): TaskResource
    {
        abort_unless(Permissions::canViewTask($request->user(), $task), 404);

        return new TaskResource($this->loadForShow($task));
    }

    public function update(Request $request, Organization $organization, Task $task): TaskResource
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless(Permissions::canUpdateTask($user, $task), 403, 'You cannot edit this task.');

        $data = $request->validate([
            'title' => ['sometimes', 'required', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:10000'],
            'status' => ['sometimes', Rule::in(TaskStatus::values())],
            'priority' => ['sometimes', Rule::in(TaskPriority::values())],
            'assignee_id' => ['sometimes', 'nullable', 'integer'],
            'due_date' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
        ]);

        if (array_key_exists('assignee_id', $data)) {
            $this->ensureEligibleAssignee($task->project, $data['assignee_id']);
        }

        [$task, $changes] = $this->applyChanges($organization, $task, $data, $user);
        $this->notifyChanges($organization, $task, $changes, $user);

        return new TaskResource($this->loadForShow($task));
    }

    /**
     * Status change plus ordering, used by Kanban drag-and-drop and the
     * keyboard "Move to" menu. ordered_ids is the full target column order.
     */
    public function move(Request $request, Organization $organization, Task $task): TaskResource
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless(Permissions::canUpdateTask($user, $task), 403, 'You cannot move this task.');

        $data = $request->validate([
            'status' => ['required', Rule::in(TaskStatus::values())],
            'ordered_ids' => ['sometimes', 'array', 'max:1000'],
            'ordered_ids.*' => ['integer'],
        ]);

        [$task, $changes] = DB::transaction(function () use ($organization, $task, $data, $user) {
            $result = $this->applyChanges($organization, $task, ['status' => $data['status']], $user);

            if (! empty($data['ordered_ids'])) {
                $ids = collect($data['ordered_ids'])->unique()->values();
                // Only reorder tasks of the same project and column.
                $valid = Task::where('project_id', $task->project_id)->where('status', $data['status'])
                    ->whereIn('id', $ids)->pluck('id')->flip();
                foreach ($ids as $i => $id) {
                    if ($valid->has($id)) {
                        Task::whereKey($id)->update(['position' => $i]);
                    }
                }
            } elseif (isset($result[1]['status'])) {
                $result[0]->update(['position' => (int) Task::where('project_id', $task->project_id)->where('status', $data['status'])->max('position') + 1]);
            }

            return $result;
        });

        $this->notifyChanges($organization, $task, $changes, $user);

        return new TaskResource($this->loadForShow($task->fresh()));
    }

    public function destroy(Request $request, Organization $organization, Task $task): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless(Permissions::canDeleteTask($user, $task), 403, 'Only project managers can delete tasks.');

        DB::transaction(function () use ($task, $organization, $user) {
            $task->attachments()->update(['attachable_type' => null, 'attachable_id' => null]);
            ActivityLog::record($organization->id, $user, 'task.deleted', null, ['title' => $task->title], $task->project_id);
            $task->delete();
        });

        return response()->json(['message' => 'Task deleted.']);
    }

    public function activity(Request $request, Organization $organization, Task $task): AnonymousResourceCollection
    {
        abort_unless(Permissions::canViewTask($request->user(), $task), 404);

        return ActivityResource::collection(
            $organization->activities()->with('actor')
                ->where('subject_type', 'task')->where('subject_id', $task->id)
                ->latest('id')->paginate(50)
        );
    }

    /** Link already-uploaded files to the task (project members only). */
    public function attachFiles(Request $request, Organization $organization, Task $task): TaskResource
    {
        $user = $request->user();
        abort_unless(Permissions::canViewTask($user, $task), 404);
        abort_unless(Permissions::canContributeToProject($user, $task->project), 403, 'Only project members can add files.');
        $data = $request->validate(['attachment_ids' => ['required', 'array', 'min:1', 'max:10'], 'attachment_ids.*' => ['integer']]);

        DB::transaction(function () use ($user, $organization, $data, $task) {
            Attachments::attach($user, $organization, $data['attachment_ids'], $task);
            ActivityLog::record($organization->id, $user, 'task.updated', $task, ['field' => 'attachments', 'title' => $task->title], $task->project_id);
        });

        return new TaskResource($this->loadForShow($task));
    }

    // ------------------------------------------------------------ Checklist

    public function addChecklistItem(Request $request, Organization $organization, Task $task): TaskResource
    {
        $this->authorizeUpdate($request, $task);
        $data = $request->validate(['body' => ['required', 'string', 'max:300']]);
        $task->checklistItems()->create(['body' => $data['body'], 'position' => (int) $task->checklistItems()->max('position') + 1]);

        return new TaskResource($this->loadForShow($task));
    }

    public function updateChecklistItem(Request $request, Organization $organization, Task $task, TaskChecklistItem $checklistItem): TaskResource
    {
        $this->authorizeUpdate($request, $task);
        $data = $request->validate([
            'body' => ['sometimes', 'required', 'string', 'max:300'],
            'is_done' => ['sometimes', 'boolean'],
        ]);
        $checklistItem->update($data);

        return new TaskResource($this->loadForShow($task));
    }

    public function deleteChecklistItem(Request $request, Organization $organization, Task $task, TaskChecklistItem $checklistItem): TaskResource
    {
        $this->authorizeUpdate($request, $task);
        $checklistItem->delete();

        return new TaskResource($this->loadForShow($task));
    }

    // -------------------------------------------------------------- Helpers

    /** @return array{0: Task, 1: array<string, array{from: mixed, to: mixed}>} */
    private function applyChanges(Organization $organization, Task $task, array $data, User $user): array
    {
        return DB::transaction(function () use ($organization, $task, $data, $user) {
            $task = Task::whereKey($task->id)->lockForUpdate()->first();
            $task->fill($data);

            if ($task->isDirty('status')) {
                $task->completed_at = $task->status === TaskStatus::Done ? now() : null;
            }

            $changes = [];
            foreach ($task->getDirty() as $field => $value) {
                if (in_array($field, ['completed_at', 'position', 'updated_at'], true)) {
                    continue;
                }
                $original = $task->getOriginal($field);
                $changes[$field] = [
                    'from' => $original instanceof \BackedEnum ? $original->value : ($original instanceof \DateTimeInterface ? $original->format('Y-m-d') : $original),
                    'to' => $task->{$field} instanceof \BackedEnum ? $task->{$field}->value : ($task->{$field} instanceof \DateTimeInterface ? $task->{$field}->format('Y-m-d') : $value),
                ];
            }
            $task->save();

            foreach ($changes as $field => $change) {
                if ($field === 'description') {
                    $change = []; // do not copy long text into the activity log
                }
                $event = match ($field) {
                    'status' => 'task.status_changed',
                    'assignee_id' => 'task.assigned',
                    default => 'task.updated',
                };
                ActivityLog::record($organization->id, $user, $event, $task, ['field' => $field, 'title' => $task->title] + $change, $task->project_id);
            }

            return [$task, $changes];
        });
    }

    private function notifyChanges(Organization $organization, Task $task, array $changes, User $actor): void
    {
        if (isset($changes['assignee_id']) && $task->assignee_id) {
            $this->notifyAssigned($organization, $task, $actor);
        }

        if (isset($changes['status'])) {
            $label = TaskStatus::from($changes['status']['to'])->label();
            Notifier::send($organization->id, array_filter([$task->created_by, $task->assignee_id, $task->project->manager_id]),
                'task.updated', $actor->name.' moved "'.$task->title.'" to '.$label, null,
                '/projects/'.$task->project_id.'?task='.$task->id, $actor->id);
        }
    }

    private function notifyAssigned(Organization $organization, Task $task, User $actor): void
    {
        Notifier::send($organization->id, [$task->assignee_id], 'task.assigned',
            $actor->name.' assigned you "'.$task->title.'"',
            $task->due_date ? 'Due '.$task->due_date->format('j M Y') : null,
            '/projects/'.$task->project_id.'?task='.$task->id, $actor->id,
            'task-assigned:'.$task->id.':'.$task->assignee_id.':'.$task->updated_at->timestamp);
    }

    /** Assignees must be active workspace members who belong to the project. */
    private function ensureEligibleAssignee(Project $project, ?int $assigneeId): void
    {
        if ($assigneeId === null) {
            return;
        }

        $eligible = $project->memberships()->where('user_id', $assigneeId)->exists()
            && $project->organization->hasActiveMember($assigneeId);

        abort_unless($eligible, 422, 'The assignee must be a member of this project.');
    }

    private function authorizeUpdate(Request $request, Task $task): void
    {
        abort_unless(Permissions::canViewTask($request->user(), $task), 404);
        abort_unless(Permissions::canUpdateTask($request->user(), $task), 403, 'You cannot edit this task.');
    }

    private function loadForShow(Task $task): Task
    {
        return $task->load(['assignee', 'creator', 'project.memberships', 'checklistItems', 'attachments.uploader'])
            ->loadCount(['comments', 'checklistItems', 'checklistItems as checklist_done_count' => fn ($q) => $q->where('is_done', true)]);
    }

    private function today(Organization $organization): string
    {
        return now($organization->timezone)->toDateString();
    }
}
