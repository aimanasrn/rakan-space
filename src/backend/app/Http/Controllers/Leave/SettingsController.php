<?php

namespace App\Http\Controllers\Leave;

use App\Http\Controllers\Controller;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Leave\LeaveEntitlement;
use App\Models\Leave\LeaveType;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Leave\Leaves;
use App\Support\Permissions;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** Leave types, yearly entitlements and the approval workflow. Leave admins only. */
class SettingsController extends Controller
{
    /** Leave types for everyone with the app (the apply form needs them). */
    public function types(Request $request, Organization $organization): JsonResponse
    {
        return response()->json(['data' => Leaves::types($organization)->map(fn (LeaveType $t) => $this->type($t))->values()]);
    }

    public function show(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::canAdministerLeave($request->user(), $organization->id), 403);

        return response()->json(['data' => $this->payload($organization)]);
    }

    public function update(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canAdministerLeave($user, $organization->id), 403);
        $request->validate([
            // Only active workflows of this organisation (null = default workflow).
            'workflow_id' => ['nullable', 'integer', Rule::exists('approval_workflows', 'id')
                ->where('organization_id', $organization->id)->where('is_active', true)],
            'types' => ['sometimes', 'array', 'max:50'],
            'types.*.id' => ['required', 'integer'],
            'types.*.entitlement_days' => ['present', 'nullable', 'numeric', 'min:0', 'max:365', 'multiple_of:0.5'],
            'types.*.is_active' => ['required', 'boolean'],
        ]);

        DB::transaction(function () use ($organization, $request, $user) {
            if ($request->has('workflow_id')) {
                $settings = Leaves::settings($organization, lock: true);
                $settings->update(['workflow_id' => $request->input('workflow_id')]);
                if (! $settings->workflow_id) {
                    Leaves::workflow($organization, $user);
                }
            }

            if ($request->has('types')) {
                $types = Leaves::types($organization)->keyBy('id');
                foreach ($request->input('types') as $i => $row) {
                    // Type IDs come from the client: only this organisation's types.
                    $type = $types->get((int) $row['id']);
                    if (! $type) {
                        throw ValidationException::withMessages(["types.$i.id" => 'Unknown leave type.']);
                    }
                    $type->update([
                        'entitlement_days' => $row['entitlement_days'] === null ? null : (float) $row['entitlement_days'],
                        'is_active' => (bool) $row['is_active'],
                    ]);
                }
                if (! LeaveType::where('organization_id', $organization->id)->where('is_active', true)->exists()) {
                    throw ValidationException::withMessages(['types' => 'Keep at least one leave type turned on.']);
                }
            }

            ActivityLog::audit($organization->id, $user, 'leave.settings_updated', null, [
                'workflow_id' => Leaves::settings($organization)->workflow_id,
            ]);
        });

        return response()->json(['data' => $this->payload($organization)]);
    }

    /**
     * Sets a member's entitlement for some leave types in a year. days = null
     * goes back to the leave type's default.
     */
    public function updateEntitlements(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canAdministerLeave($user, $organization->id), 403);
        $data = $request->validate([
            'user_id' => ['required', 'integer'],
            'year' => ['required', 'integer', 'min:2000', 'max:2100'],
            'entitlements' => ['required', 'array', 'max:50'],
            'entitlements.*.leave_type_id' => ['required', 'integer'],
            'entitlements.*.days' => ['present', 'nullable', 'numeric', 'min:0', 'max:365', 'multiple_of:0.5'],
        ]);
        // Never trust the member ID: only active members of this organisation.
        if ($organization->filterActiveMemberIds([$data['user_id']]) === []) {
            throw ValidationException::withMessages(['user_id' => 'Choose a member of this workspace.']);
        }

        DB::transaction(function () use ($organization, $data, $user) {
            $types = Leaves::types($organization)->keyBy('id');
            foreach ($data['entitlements'] as $i => $row) {
                if (! $types->has((int) $row['leave_type_id'])) {
                    throw ValidationException::withMessages(["entitlements.$i.leave_type_id" => 'Unknown leave type.']);
                }
                $key = [
                    'organization_id' => $organization->id, 'user_id' => (int) $data['user_id'],
                    'leave_type_id' => (int) $row['leave_type_id'], 'year' => (int) $data['year'],
                ];
                if ($row['days'] === null) {
                    LeaveEntitlement::where($key)->delete();
                } else {
                    LeaveEntitlement::updateOrCreate($key, ['days' => (float) $row['days']]);
                }
            }
            ActivityLog::audit($organization->id, $user, 'leave.entitlements_updated', null, [
                'user_id' => (int) $data['user_id'], 'year' => (int) $data['year'],
            ]);
        });

        return response()->json(['data' => [
            'year' => (int) $data['year'],
            'types' => Leaves::balances($organization, (int) $data['user_id'], (int) $data['year']),
        ]]);
    }

    private function payload(Organization $organization): array
    {
        $settings = Leaves::settings($organization);

        return [
            'workflow_id' => $settings->workflow_id,
            'workflows' => ApprovalWorkflow::where('organization_id', $organization->id)->where('is_active', true)
                ->withCount('steps')->orderBy('name')->get(['id', 'name', 'description'])
                ->map(fn ($w) => ['id' => $w->id, 'name' => $w->name, 'description' => $w->description, 'steps_count' => $w->steps_count]),
            'types' => Leaves::types($organization)->map(fn (LeaveType $t) => $this->type($t))->values(),
        ];
    }

    private function type(LeaveType $t): array
    {
        return [
            'id' => $t->id, 'key' => $t->key, 'name' => $t->name, 'color' => $t->color,
            'entitlement_days' => $t->entitlement_days, 'is_active' => $t->is_active,
        ];
    }
}
