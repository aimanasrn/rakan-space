<?php

namespace App\Http\Controllers;

use App\Http\Resources\DepartmentResource;
use App\Models\Department;
use App\Models\Organization;
use App\Support\ActivityLog;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

class DepartmentController extends Controller
{
    public function index(Organization $organization): AnonymousResourceCollection
    {
        return DepartmentResource::collection(
            $organization->departments()->withCount('users')->orderBy('name')->get()
        );
    }

    public function show(Organization $organization, Department $department): DepartmentResource
    {
        return new DepartmentResource($department->load(['users' => fn ($q) => $q->orderBy('name')])->loadCount('users'));
    }

    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->requireAdmin($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', Rule::unique('departments')->where('organization_id', $organization->id)],
            'description' => ['nullable', 'string', 'max:500'],
        ]);

        $department = $organization->departments()->create($data);
        ActivityLog::audit($organization->id, $request->user(), 'department.created', $department, ['name' => $department->name]);

        return (new DepartmentResource($department->loadCount('users')))->response()->setStatusCode(201);
    }

    public function update(Request $request, Organization $organization, Department $department): DepartmentResource
    {
        $this->requireAdmin($request);
        $data = $request->validate([
            'name' => ['required', 'string', 'max:120', Rule::unique('departments')->where('organization_id', $organization->id)->ignore($department->id)],
            'description' => ['nullable', 'string', 'max:500'],
        ]);

        $department->update($data);

        return new DepartmentResource($department->loadCount('users'));
    }

    public function destroy(Request $request, Organization $organization, Department $department): JsonResponse
    {
        $this->requireAdmin($request);
        abort_if($department->organization->announcements()->where('department_id', $department->id)->exists(), 422,
            'This department has announcements. Delete or retarget them first.');

        $department->delete();
        ActivityLog::audit($organization->id, $request->user(), 'department.deleted', null, ['name' => $department->name]);

        return response()->json(['message' => 'Department deleted.']);
    }

    /** Replaces the department's members. Only active members of this organisation are accepted. */
    public function syncMembers(Request $request, Organization $organization, Department $department): DepartmentResource
    {
        $this->requireAdmin($request);
        $data = $request->validate([
            'user_ids' => ['present', 'array', 'max:500'],
            'user_ids.*' => ['integer'],
        ]);

        $ids = $organization->filterActiveMemberIds($data['user_ids']);
        abort_if(count($ids) !== count(array_unique($data['user_ids'])), 422, 'Some selected people are not active members of this workspace.');

        DB::transaction(function () use ($department, $ids, $organization) {
            $department->users()->sync(collect($ids)->mapWithKeys(fn ($id) => [$id => ['organization_id' => $organization->id]])->all());
        });

        ActivityLog::audit($organization->id, $request->user(), 'department.members_updated', $department, ['count' => count($ids)]);

        return new DepartmentResource($department->load(['users' => fn ($q) => $q->orderBy('name')])->loadCount('users'));
    }

    private function requireAdmin(Request $request): void
    {
        abort_unless($request->attributes->get('membership')->isAdministrator(), 403, 'Only owners and admins can manage departments.');
    }
}
