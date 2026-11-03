<?php

namespace App\Http\Controllers\Approval;

use App\Enums\AppAbility;
use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Http\Resources\Approval\WorkflowResource;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Approval\ApprovalWorkflowStep;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Conditions;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Workflow designer. Requires the Approval app's "admin" ability. */
class WorkflowController extends Controller
{
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'status' => ['nullable', Rule::in(['all', 'active', 'inactive'])],
            'options' => ['nullable', 'boolean'],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:100'],
        ]);
        $user = $request->user();
        $manager = Permissions::canManageApprovalWorkflows($user, $organization->id);

        // Light list of active workflows for pickers (form builders, new request).
        if ($request->boolean('options')) {
            abort_unless($manager || Permissions::canBuildForms($user, $organization->id)
                || Permissions::hasAppAbility($user, $organization->id, 'approval', AppAbility::Create), 403);

            return WorkflowResource::collection($organization->approvalWorkflows()->where('is_active', true)->withCount('steps')->orderBy('name')->get());
        }

        abort_unless($manager, 403, 'Only approval admins can manage workflows.');
        $status = $request->input('status', 'all');
        $query = $organization->approvalWorkflows()->withCount('steps')->with('creator')
            ->addSelect(['requests_count' => ApprovalRequest::selectRaw('count(*)')->whereColumn('workflow_id', 'approval_workflows.id')])
            ->when($status !== 'all', fn ($q) => $q->where('is_active', $status === 'active'))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('name', 'ilike', $term)->orWhere('description', 'ilike', $term));
            })
            ->orderBy('name');

        return WorkflowResource::collection($query->paginate($request->integer('per_page', 20)));
    }

    public function show(Request $request, Organization $organization, ApprovalWorkflow $approvalWorkflow): JsonResponse
    {
        $this->requireManager($request, $organization);

        return response()->json(['data' => new WorkflowResource($approvalWorkflow->load(['steps', 'creator']))]);
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->requireManager($request, $organization);
        $data = $this->validated($request, $organization);

        $workflow = DB::transaction(function () use ($organization, $data, $request) {
            $workflow = $organization->approvalWorkflows()->create([
                'name' => $data['name'], 'description' => $data['description'] ?? null,
                'is_active' => $data['is_active'] ?? true, 'created_by' => $request->user()->id,
            ]);
            $this->syncSteps($workflow, $data['steps']);
            ActivityLog::audit($organization->id, $request->user(), 'approval.workflow_created', $workflow, ['name' => $workflow->name]);

            return $workflow;
        });

        return response()->json(['data' => new WorkflowResource($workflow->load(['steps', 'creator']))], 201);
    }

    /** Replaces the workflow's steps. Requests already in progress keep their own copy. */
    public function update(Request $request, Organization $organization, ApprovalWorkflow $approvalWorkflow): JsonResponse
    {
        $this->requireManager($request, $organization);
        $data = $this->validated($request, $organization);

        DB::transaction(function () use ($organization, $approvalWorkflow, $data, $request) {
            $approvalWorkflow->update([
                'name' => $data['name'], 'description' => $data['description'] ?? null, 'is_active' => $data['is_active'] ?? $approvalWorkflow->is_active,
            ]);
            $this->syncSteps($approvalWorkflow, $data['steps']);
            ActivityLog::audit($organization->id, $request->user(), 'approval.workflow_updated', $approvalWorkflow, ['name' => $approvalWorkflow->name]);
        });

        return response()->json(['data' => new WorkflowResource($approvalWorkflow->fresh()->load(['steps', 'creator']))]);
    }

    public function destroy(Request $request, Organization $organization, ApprovalWorkflow $approvalWorkflow): JsonResponse
    {
        $this->requireManager($request, $organization);
        abort_if(ApprovalRequest::where('workflow_id', $approvalWorkflow->id)->exists(), 422,
            'This workflow has been used. Turn it off instead so its history is kept.');

        $approvalWorkflow->delete();
        ActivityLog::audit($organization->id, $request->user(), 'approval.workflow_deleted', null, ['name' => $approvalWorkflow->name]);

        return response()->json(['message' => 'Workflow deleted.']);
    }

    private function validated(Request $request, Organization $organization): array
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'min:2', 'max:120'],
            'description' => ['nullable', 'string', 'max:1000'],
            'is_active' => ['sometimes', 'boolean'],
            'steps' => ['required', 'array', 'min:1', 'max:20'],
            'steps.*.name' => ['required', 'string', 'max:120'],
            'steps.*.mode' => ['required', Rule::in([ApprovalWorkflowStep::MODE_ANY, ApprovalWorkflowStep::MODE_ALL])],
            'steps.*.approvers' => ['required', 'array', 'min:1', 'max:20'],
            'steps.*.approvers.*.type' => ['required', Rule::in(['user', 'role', 'manager'])],
            'steps.*.approvers.*.user_id' => ['nullable', 'integer'],
            'steps.*.approvers.*.role' => ['nullable', Rule::in(Role::values())],
            'steps.*.sla_hours' => ['nullable', 'integer', 'min:1', 'max:720'],
            'steps.*.escalate_to' => ['nullable', 'integer'],
            ...Conditions::rules('steps.*.condition'),
        ], [], ['steps.*.name' => 'step name']);

        // People must be active members of this organisation (never trust client IDs).
        $userIds = collect($data['steps'])->flatMap(fn ($s) => [
            ...collect($s['approvers'])->where('type', 'user')->pluck('user_id'),
            $s['escalate_to'] ?? null,
        ])->filter()->all();
        $active = $organization->filterActiveMemberIds($userIds);

        $errors = [];
        foreach ($data['steps'] as $i => &$step) {
            $approvers = [];
            foreach ($step['approvers'] as $a) {
                if ($a['type'] === 'user') {
                    if (empty($a['user_id']) || ! in_array((int) $a['user_id'], $active, true)) {
                        $errors["steps.$i.approvers"] = 'Choose active members of this workspace.';

                        continue;
                    }
                    $approvers['user:'.$a['user_id']] = ['type' => 'user', 'user_id' => (int) $a['user_id']];
                } elseif ($a['type'] === 'role') {
                    if (empty($a['role'])) {
                        $errors["steps.$i.approvers"] = 'Choose a role.';

                        continue;
                    }
                    $approvers['role:'.$a['role']] = ['type' => 'role', 'role' => $a['role']];
                } else {
                    $approvers['manager'] = ['type' => 'manager'];
                }
            }
            $step['approvers'] = array_values($approvers);
            if (! empty($step['escalate_to']) && ! in_array((int) $step['escalate_to'], $active, true)) {
                $errors["steps.$i.escalate_to"] = 'Choose an active member of this workspace.';
            }
            if (! empty($step['escalate_to']) && empty($step['sla_hours'])) {
                $errors["steps.$i.sla_hours"] = 'Set a time limit to use escalation.';
            }
        }
        unset($step);

        if ($errors) {
            throw ValidationException::withMessages($errors);
        }

        return $data;
    }

    private function syncSteps(ApprovalWorkflow $workflow, array $steps): void
    {
        $workflow->steps()->delete();
        foreach (array_values($steps) as $i => $step) {
            ApprovalWorkflowStep::create([
                'organization_id' => $workflow->organization_id,
                'workflow_id' => $workflow->id,
                'position' => $i + 1,
                'name' => $step['name'],
                'mode' => $step['mode'],
                'approvers' => $step['approvers'],
                'condition' => ! empty($step['condition']['field']) ? [
                    'field' => $step['condition']['field'],
                    'operator' => $step['condition']['operator'],
                    'value' => $step['condition']['value'] ?? null,
                ] : null,
                'sla_hours' => $step['sla_hours'] ?? null,
                'escalate_to' => $step['escalate_to'] ?? null,
            ]);
        }
    }

    private function requireManager(Request $request, Organization $organization): void
    {
        abort_unless(Permissions::canManageApprovalWorkflows($request->user(), $organization->id), 403, 'Only approval admins can manage workflows.');
    }
}
