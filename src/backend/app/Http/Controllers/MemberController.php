<?php

namespace App\Http\Controllers;

use App\Enums\Role;
use App\Http\Resources\MembershipResource;
use App\Models\Department;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\Task;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\Approvals\Approvals;
use App\Support\ReportingLine;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

class MemberController extends Controller
{
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $viewer = $request->attributes->get('membership');
        $request->validate([
            'q' => ['nullable', 'string', 'max:100'],
            'role' => ['nullable', Rule::in(Role::values())],
            'department_id' => ['nullable', 'integer'],
            'status' => ['nullable', Rule::in(['active', 'deactivated', 'all'])],
            'per_page' => ['nullable', 'integer', 'min:1', 'max:200'],
        ]);

        // Only administrators can list deactivated members.
        $status = $viewer->isAdministrator() ? ($request->input('status') ?: 'active') : 'active';

        $query = $organization->memberships()->with(['user', 'manager'])
            ->join('users', 'users.id', '=', 'organization_memberships.user_id')
            ->select('organization_memberships.*')
            ->when($status === 'all', fn ($q) => $q->whereIn('status', [OrganizationMembership::STATUS_ACTIVE, OrganizationMembership::STATUS_DEACTIVATED]))
            ->when($status !== 'all', fn ($q) => $q->where('status', $status))
            ->when($request->filled('role'), fn ($q) => $q->where('role', $request->input('role')))
            ->when($request->filled('q'), function ($q) use ($request) {
                $term = '%'.addcslashes($request->input('q'), '%_\\').'%';
                $q->where(fn ($w) => $w->where('users.name', 'ilike', $term)
                    ->orWhere('users.email', 'ilike', $term)
                    ->orWhere('users.job_title', 'ilike', $term));
            })
            ->when($request->filled('department_id'), fn ($q) => $q->whereExists(fn ($sub) => $sub->selectRaw('1')
                ->from('department_user')
                ->whereColumn('department_user.user_id', 'organization_memberships.user_id')
                ->where('department_user.organization_id', $organization->id)
                ->where('department_user.department_id', $request->integer('department_id'))))
            ->orderBy('users.name');

        $page = $query->paginate($request->integer('per_page', 25));

        // Attach departments in one query (avoids N+1).
        $userIds = $page->getCollection()->pluck('user_id');
        $departments = Department::query()
            ->join('department_user', 'department_user.department_id', '=', 'departments.id')
            ->where('departments.organization_id', $organization->id)
            ->whereIn('department_user.user_id', $userIds)
            ->get(['departments.id', 'departments.name', 'departments.description', 'department_user.user_id'])
            ->groupBy('user_id');

        $page->getCollection()->each(fn ($m) => $m->departments = $departments->get($m->user_id, collect()));

        return MembershipResource::collection($page);
    }

    public function update(Request $request, Organization $organization, OrganizationMembership $membership): JsonResponse
    {
        $actor = $request->attributes->get('membership');
        $data = $request->validate(['role' => ['required', Rule::in(Role::values())]]);
        $newRole = Role::from($data['role']);

        $this->authorizeManage($actor, $membership);
        abort_unless($actor->role->canAssign($newRole), 403, 'You cannot assign this role.');

        DB::transaction(function () use ($organization, $membership, $newRole, $request) {
            $membership = OrganizationMembership::whereKey($membership->id)->lockForUpdate()->first();
            if ($membership->role === Role::Owner && $newRole !== Role::Owner) {
                $this->ensureAnotherOwner($organization, $membership);
            }

            $old = $membership->role;
            $membership->update(['role' => $newRole]);

            ActivityLog::audit($organization->id, $request->user(), 'member.role_changed', $membership, [
                'user_id' => $membership->user_id, 'from' => $old->value, 'to' => $newRole->value,
            ]);
        });

        return response()->json(['data' => new MembershipResource($membership->fresh('user'))]);
    }

    /** Sets or clears who the member reports to. Owners and Admins only. */
    public function updateManager(Request $request, Organization $organization, OrganizationMembership $membership): JsonResponse
    {
        $actor = $request->attributes->get('membership');
        abort_unless($actor->isAdministrator(), 403, 'Only owners and admins can set reporting managers.');
        abort_if($membership->status === OrganizationMembership::STATUS_REMOVED, 422, 'This member has been removed.');

        $data = $request->validate(['manager_id' => ['present', 'nullable', 'integer']]);
        $managerId = $data['manager_id'] !== null ? (int) $data['manager_id'] : null;

        if ($managerId !== null) {
            if ($managerId === $membership->user_id) {
                throw ValidationException::withMessages(['manager_id' => 'A member cannot report to themselves.']);
            }
            // Only active members of this organisation can be managers.
            if ($organization->filterActiveMemberIds([$managerId]) === []) {
                throw ValidationException::withMessages(['manager_id' => 'Choose an active member of this workspace.']);
            }
            if (ReportingLine::wouldCreateCycle($organization->id, $membership->user_id, $managerId)) {
                throw ValidationException::withMessages(['manager_id' => 'This would create a reporting loop.']);
            }
        }

        $old = $membership->manager_id;
        $membership->update(['manager_id' => $managerId]);
        ActivityLog::audit($organization->id, $request->user(), 'member.manager_changed', $membership, [
            'user_id' => $membership->user_id, 'from' => $old, 'to' => $managerId,
        ]);

        return response()->json(['data' => new MembershipResource($membership->fresh(['user', 'manager']))]);
    }

    public function deactivate(Request $request, Organization $organization, OrganizationMembership $membership): JsonResponse
    {
        $actor = $request->attributes->get('membership');
        $this->authorizeManage($actor, $membership);
        abort_unless($membership->isActive(), 422, 'This member is not active.');

        DB::transaction(function () use ($organization, $membership, $request) {
            if ($membership->role === Role::Owner) {
                $this->ensureAnotherOwner($organization, $membership);
            }
            $membership->update(['status' => OrganizationMembership::STATUS_DEACTIVATED, 'status_changed_at' => now()]);
            ActivityLog::audit($organization->id, $request->user(), 'member.deactivated', $membership, ['user_id' => $membership->user_id]);
        });

        OrganizationController::signalAccessRevoked($membership->user_id, $organization->id);

        return response()->json(['data' => new MembershipResource($membership->fresh('user'))]);
    }

    public function reactivate(Request $request, Organization $organization, OrganizationMembership $membership): JsonResponse
    {
        $actor = $request->attributes->get('membership');
        $this->authorizeManage($actor, $membership);
        abort_unless($membership->status === OrganizationMembership::STATUS_DEACTIVATED, 422, 'Only deactivated members can be reactivated.');

        $membership->update(['status' => OrganizationMembership::STATUS_ACTIVE, 'status_changed_at' => now()]);
        ActivityLog::audit($organization->id, $request->user(), 'member.reactivated', $membership, ['user_id' => $membership->user_id]);

        return response()->json(['data' => new MembershipResource($membership->fresh('user'))]);
    }

    /**
     * Removes a membership (or leaves the organisation when targeting yourself).
     * Revokes access immediately; authored messages, tasks and activity remain.
     * Memberships in other organisations are untouched.
     */
    public function destroy(Request $request, Organization $organization, OrganizationMembership $membership): JsonResponse
    {
        $actor = $request->attributes->get('membership');
        $leaving = $actor->id === $membership->id;

        if (! $leaving) {
            $this->authorizeManage($actor, $membership);
        }
        abort_if($membership->status === OrganizationMembership::STATUS_REMOVED, 422, 'This member has already been removed.');

        DB::transaction(function () use ($organization, $membership, $request, $leaving) {
            $membership = OrganizationMembership::whereKey($membership->id)->lockForUpdate()->first();
            if ($membership->role === Role::Owner) {
                $this->ensureAnotherOwner($organization, $membership);
            }

            // Mark removed first so approval reassignment never picks this member again.
            $membership->update(['status' => OrganizationMembership::STATUS_REMOVED, 'status_changed_at' => now()]);
            self::revokeResourceAccess($organization, $membership->user_id);

            ActivityLog::audit($organization->id, $request->user(), $leaving ? 'member.left' : 'member.removed', $membership, [
                'user_id' => $membership->user_id,
            ]);
        });

        $request->user()->forgetMembershipCache();
        OrganizationController::signalAccessRevoked($membership->user_id, $organization->id);

        return response()->json(['message' => $leaving ? 'You left the workspace.' : 'Member removed.']);
    }

    /** Removes the user's channel/project/department memberships inside this organisation only. */
    public static function revokeResourceAccess(Organization $organization, int $userId): void
    {
        DB::table('conversation_members')
            ->where('user_id', $userId)
            ->whereIn('conversation_id', fn ($q) => $q->select('id')->from('conversations')->where('organization_id', $organization->id))
            ->delete();
        DB::table('project_members')->where('organization_id', $organization->id)->where('user_id', $userId)->delete();
        DB::table('department_user')->where('organization_id', $organization->id)->where('user_id', $userId)->delete();
        DB::table('event_participants')
            ->where('user_id', $userId)
            ->whereIn('event_id', fn ($q) => $q->select('id')->from('events')->where('organization_id', $organization->id)->where('starts_at', '>', now()))
            ->delete();

        // App shortcuts and open app requests in this organisation only.
        DB::table('user_app_pins')->where('organization_id', $organization->id)->where('user_id', $userId)->delete();
        DB::table('app_access_requests')->where('organization_id', $organization->id)->where('user_id', $userId)->where('status', 'pending')->delete();
        // Approvals: end their delegations here and hand their open approval tasks on.
        DB::table('approval_delegations')->where('organization_id', $organization->id)
            ->where(fn ($q) => $q->where('delegator_id', $userId)->orWhere('delegate_id', $userId))
            ->whereNull('revoked_at')->where('ends_at', '>', now())->update(['revoked_at' => now()]);
        Approvals::removeMember($organization->id, $userId);
        // People who reported to this user no longer have a manager here.
        OrganizationMembership::where('organization_id', $organization->id)->where('manager_id', $userId)->update(['manager_id' => null]);

        // Open work returns to the unassigned pool; completed tasks keep their history.
        Task::where('organization_id', $organization->id)
            ->where('assignee_id', $userId)
            ->where('status', '!=', 'done')
            ->update(['assignee_id' => null]);
    }

    private function authorizeManage(OrganizationMembership $actor, OrganizationMembership $target): void
    {
        abort_unless($actor->isAdministrator(), 403, 'Only owners and admins can manage members.');
        abort_if($actor->id === $target->id, 403, 'You cannot change your own membership here.');
        // Admins cannot act on owners or other admins.
        abort_if($actor->role !== Role::Owner && $target->role->atLeast(Role::Admin), 403, 'Only an owner can manage owners and admins.');
    }

    private function ensureAnotherOwner(Organization $organization, OrganizationMembership $membership): void
    {
        $otherOwners = OrganizationMembership::where('organization_id', $organization->id)
            ->where('status', OrganizationMembership::STATUS_ACTIVE)
            ->where('role', Role::Owner->value)
            ->where('id', '!=', $membership->id)
            ->lockForUpdate()
            ->get(['id'])
            ->count();

        abort_if($otherOwners === 0, 422, 'Transfer ownership before removing or demoting the final owner.');
    }
}
