<?php

namespace App\Http\Controllers\Timesheet;

use App\Http\Controllers\Controller;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Organization;
use App\Support\ActivityLog;
use App\Support\Permissions;
use App\Support\Timesheets\Timesheets;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

/** Which approval workflow submitted weeks go through. Timesheet admins only. */
class SettingsController extends Controller
{
    public function show(Request $request, Organization $organization): JsonResponse
    {
        abort_unless(Permissions::canAdministerTimesheets($request->user(), $organization->id), 403);

        return response()->json(['data' => $this->payload($organization)]);
    }

    public function update(Request $request, Organization $organization): JsonResponse
    {
        $user = $request->user();
        abort_unless(Permissions::canAdministerTimesheets($user, $organization->id), 403);
        $request->validate([
            // Only active workflows of this organisation (null = default workflow).
            'workflow_id' => ['nullable', 'integer', Rule::exists('approval_workflows', 'id')
                ->where('organization_id', $organization->id)->where('is_active', true)],
        ]);

        DB::transaction(function () use ($organization, $request, $user) {
            $settings = Timesheets::settings($organization, lock: true);
            $settings->update(['workflow_id' => $request->input('workflow_id')]);
            if (! $settings->workflow_id) {
                Timesheets::workflow($organization, $user);
            }
            ActivityLog::audit($organization->id, $user, 'timesheet.settings_updated', null, ['workflow_id' => $settings->fresh()->workflow_id]);
        });

        return response()->json(['data' => $this->payload($organization)]);
    }

    private function payload(Organization $organization): array
    {
        $settings = Timesheets::settings($organization);

        return [
            'workflow_id' => $settings->workflow_id,
            'workflows' => ApprovalWorkflow::where('organization_id', $organization->id)->where('is_active', true)
                ->withCount('steps')->orderBy('name')->get(['id', 'name', 'description'])
                ->map(fn ($w) => ['id' => $w->id, 'name' => $w->name, 'description' => $w->description, 'steps_count' => $w->steps_count]),
        ];
    }
}
