<?php

namespace App\Support;

use App\Enums\AppAbility;
use App\Enums\Role;
use App\Models\Announcement;
use App\Models\AppRolePermission;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalStepApprover;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\Crm\Account as CrmAccount;
use App\Models\Crm\Activity as CrmActivity;
use App\Models\Crm\Contact as CrmContact;
use App\Models\Crm\Opportunity;
use App\Models\Event;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Helpdesk\Ticket;
use App\Models\Helpdesk\TicketMessage;
use App\Models\LauncherApp;
use App\Models\LauncherBanner;
use App\Models\Leave\LeaveRequest;
use App\Models\Message;
use App\Models\OrganizationApp;
use App\Models\OrganizationMembership;
use App\Models\Project;
use App\Models\Task;
use App\Models\Timesheet\Timesheet;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Facades\DB;

/**
 * Single source of truth for resource-level access rules.
 *
 * Every check starts from the user's *current, active* organisation membership,
 * so removing or deactivating a membership revokes access immediately.
 *
 * Owner/Admin management rights deliberately do NOT include private channels
 * or direct conversations (see docs/permissions.md).
 */
class Permissions
{
    public static function membership(User $user, int $organizationId): ?OrganizationMembership
    {
        return $user->membershipIn($organizationId);
    }

    public static function role(User $user, int $organizationId): ?Role
    {
        return self::membership($user, $organizationId)?->role;
    }

    public static function isAdmin(User $user, int $organizationId): bool
    {
        return (bool) self::role($user, $organizationId)?->isAdministrator();
    }

    public static function hasRole(User $user, int $organizationId, Role $minimum): bool
    {
        return (bool) self::role($user, $organizationId)?->atLeast($minimum);
    }

    // ---------------------------------------------------------------- Projects

    public static function projectRole(User $user, Project $project): ?string
    {
        if ($project->relationLoaded('memberships')) {
            return $project->memberships->firstWhere('user_id', $user->id)?->role;
        }

        return $project->memberships()->where('user_id', $user->id)->value('role');
    }

    public static function canViewProject(User $user, Project $project): bool
    {
        if (! self::membership($user, $project->organization_id)) {
            return false;
        }

        return self::isAdmin($user, $project->organization_id)
            || $project->visibility === Project::VISIBILITY_ORGANIZATION
            || self::projectRole($user, $project) !== null;
    }

    /** Edit project details, membership, archive, delete tasks, assign anyone. */
    public static function canManageProject(User $user, Project $project): bool
    {
        if (! self::membership($user, $project->organization_id)) {
            return false;
        }

        return self::isAdmin($user, $project->organization_id)
            || $project->manager_id === $user->id
            || self::projectRole($user, $project) === 'manager';
    }

    /** Create tasks, comment, upload project files. */
    public static function canContributeToProject(User $user, Project $project): bool
    {
        if ($project->archived_at !== null) {
            return false;
        }

        return self::canManageProject($user, $project) || (
            self::membership($user, $project->organization_id) !== null
            && self::projectRole($user, $project) !== null
        );
    }

    public static function visibleProjectsQuery(User $user, int $organizationId): Builder
    {
        $query = Project::query()->where('organization_id', $organizationId);

        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('1 = 0');
        }

        if (self::isAdmin($user, $organizationId)) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where('visibility', Project::VISIBILITY_ORGANIZATION)
                ->orWhereExists(function ($sub) use ($user) {
                    $sub->selectRaw('1')->from('project_members')
                        ->whereColumn('project_members.project_id', 'projects.id')
                        ->where('project_members.user_id', $user->id);
                });
        });
    }

    // ------------------------------------------------------------------- Tasks

    public static function canViewTask(User $user, Task $task): bool
    {
        return self::canViewProject($user, $task->project);
    }

    /** Edit fields and change status. */
    public static function canUpdateTask(User $user, Task $task): bool
    {
        $project = $task->project;
        if ($project->archived_at !== null || ! self::canViewProject($user, $project)) {
            return false;
        }

        if (self::canManageProject($user, $project)) {
            return true;
        }

        $isProjectMember = self::projectRole($user, $project) !== null;

        return $isProjectMember && ($task->assignee_id === $user->id || $task->created_by === $user->id);
    }

    public static function canDeleteTask(User $user, Task $task): bool
    {
        return self::canManageProject($user, $task->project);
    }

    // ----------------------------------------------------------- Conversations

    public static function isConversationMember(User $user, Conversation $conversation): bool
    {
        return $conversation->memberships()->where('user_id', $user->id)->exists();
    }

    /** Read messages and subscribe to the real-time channel. */
    public static function canViewConversation(User $user, Conversation $conversation): bool
    {
        if (! self::membership($user, $conversation->organization_id)) {
            return false;
        }

        return $conversation->isPublic() || self::isConversationMember($user, $conversation);
    }

    public static function canPostInConversation(User $user, Conversation $conversation): bool
    {
        return $conversation->archived_at === null
            && self::membership($user, $conversation->organization_id) !== null
            && self::isConversationMember($user, $conversation);
    }

    /** Rename, change topic, manage channel members, archive. */
    public static function canManageConversation(User $user, Conversation $conversation): bool
    {
        if (! $conversation->isChannel() || ! self::membership($user, $conversation->organization_id)) {
            return false;
        }

        $isChannelAdmin = $conversation->memberships()
            ->where('user_id', $user->id)->where('role', 'admin')->exists();

        // Org administrators may moderate public channels, never private ones.
        return $isChannelAdmin || ($conversation->isPublic() && self::isAdmin($user, $conversation->organization_id));
    }

    public static function canEditMessage(User $user, Message $message): bool
    {
        return ! $message->isDeleted()
            && $message->user_id === $user->id
            && self::canPostInConversation($user, $message->conversation);
    }

    public static function canDeleteMessage(User $user, Message $message): bool
    {
        if ($message->isDeleted()) {
            return false;
        }

        if ($message->user_id === $user->id) {
            return self::canPostInConversation($user, $message->conversation);
        }

        return self::canManageConversation($user, $message->conversation);
    }

    /** Conversations the user may read: their memberships plus public channels. */
    public static function visibleConversationsQuery(User $user, int $organizationId): Builder
    {
        $query = Conversation::query()->where('organization_id', $organizationId);

        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where(fn (Builder $p) => $p->where('type', Conversation::TYPE_CHANNEL)->where('visibility', Conversation::VISIBILITY_PUBLIC))
                ->orWhereExists(function ($sub) use ($user) {
                    $sub->selectRaw('1')->from('conversation_members')
                        ->whereColumn('conversation_members.conversation_id', 'conversations.id')
                        ->where('conversation_members.user_id', $user->id);
                });
        });
    }

    // ----------------------------------------------------------- Announcements

    public static function canPublishAnnouncements(User $user, int $organizationId): bool
    {
        return self::hasRole($user, $organizationId, Role::Manager);
    }

    /** Managers may publish organisation-wide and to departments they belong to. */
    public static function canPublishToDepartment(User $user, int $organizationId, int $departmentId): bool
    {
        if (self::isAdmin($user, $organizationId)) {
            return true;
        }

        return self::canPublishAnnouncements($user, $organizationId)
            && \DB::table('department_user')->where('department_id', $departmentId)->where('user_id', $user->id)->exists();
    }

    public static function canViewAnnouncement(User $user, Announcement $announcement): bool
    {
        if (! self::membership($user, $announcement->organization_id)) {
            return false;
        }

        if ($announcement->audience === Announcement::AUDIENCE_ORGANIZATION
            || $announcement->author_id === $user->id
            || self::isAdmin($user, $announcement->organization_id)) {
            return true;
        }

        return \DB::table('department_user')
            ->where('department_id', $announcement->department_id)
            ->where('user_id', $user->id)->exists();
    }

    public static function canManageAnnouncement(User $user, Announcement $announcement): bool
    {
        return self::membership($user, $announcement->organization_id) !== null
            && ($announcement->author_id === $user->id || self::isAdmin($user, $announcement->organization_id));
    }

    public static function visibleAnnouncementsQuery(User $user, int $organizationId): Builder
    {
        $query = Announcement::query()->where('organization_id', $organizationId);

        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('1 = 0');
        }

        if (self::isAdmin($user, $organizationId)) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where('audience', Announcement::AUDIENCE_ORGANIZATION)
                ->orWhere('author_id', $user->id)
                ->orWhereExists(function ($sub) use ($user) {
                    $sub->selectRaw('1')->from('department_user')
                        ->whereColumn('department_user.department_id', 'announcements.department_id')
                        ->where('department_user.user_id', $user->id);
                });
        });
    }

    // ------------------------------------------------------------------ Events

    public static function canViewEvent(User $user, Event $event): bool
    {
        if (! self::membership($user, $event->organization_id)) {
            return false;
        }

        return $event->audience === Event::AUDIENCE_EVERYONE
            || $event->created_by === $user->id
            || $event->participants()->where('users.id', $user->id)->exists();
    }

    public static function canManageEvent(User $user, Event $event): bool
    {
        return self::membership($user, $event->organization_id) !== null
            && ($event->created_by === $user->id || self::isAdmin($user, $event->organization_id));
    }

    public static function visibleEventsQuery(User $user, int $organizationId): Builder
    {
        $query = Event::query()->where('organization_id', $organizationId);

        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('1 = 0');
        }

        return $query->where(function (Builder $q) use ($user) {
            $q->where('audience', Event::AUDIENCE_EVERYONE)
                ->orWhere('created_by', $user->id)
                ->orWhereExists(function ($sub) use ($user) {
                    $sub->selectRaw('1')->from('event_participants')
                        ->whereColumn('event_participants.event_id', 'events.id')
                        ->where('event_participants.user_id', $user->id);
                });
        });
    }

    // ------------------------------------------------------------- Attachments

    /** File access follows the parent resource's *current* permissions. */
    public static function canViewAttachment(User $user, Attachment $attachment): bool
    {
        if (! self::membership($user, $attachment->organization_id)) {
            return false;
        }

        if ($attachment->isPending()) {
            return $attachment->uploader_id === $user->id;
        }

        $parent = $attachment->attachable;
        if (! $parent || $parent->organization_id !== $attachment->organization_id) {
            return false;
        }

        return match (true) {
            $parent instanceof Message => ! $parent->isDeleted() && self::canViewConversation($user, $parent->conversation),
            $parent instanceof Task => self::canViewTask($user, $parent),
            $parent instanceof Project => self::canViewProject($user, $parent),
            $parent instanceof Announcement => self::canViewAnnouncement($user, $parent),
            $parent instanceof FormSubmission => self::canViewSubmission($user, $parent),
            $parent instanceof TicketMessage => self::canViewTicketMessage($user, $parent),
            $parent instanceof Ticket => self::canViewTicket($user, $parent),
            default => false,
        };
    }

    public static function canDeleteAttachment(User $user, Attachment $attachment): bool
    {
        if (! self::canViewAttachment($user, $attachment)) {
            return false;
        }

        if ($attachment->uploader_id === $user->id) {
            return true;
        }

        $parent = $attachment->attachable;

        return match (true) {
            $parent instanceof Task => self::canManageProject($user, $parent->project),
            $parent instanceof Project => self::canManageProject($user, $parent),
            $parent instanceof Announcement => self::canManageAnnouncement($user, $parent),
            default => false,
        };
    }

    // -------------------------------------------------------------------- Apps
    //
    // App abilities only cover the app's own data. They never open private
    // channels, direct messages or private events.

    /** Owners and Admins install apps, set app permissions and manage banners. */
    public static function canManageApps(User $user, int $organizationId): bool
    {
        return self::isAdmin($user, $organizationId);
    }

    /**
     * The user's abilities in every app installed for the organisation, keyed by
     * app id. Apps that are not installed, or where the role has no abilities,
     * are left out.
     *
     * @return array<int, list<string>>
     */
    public static function appAbilitiesMap(User $user, int $organizationId): array
    {
        // Memoised per HTTP request only (a new request always re-reads permissions).
        $request = app()->bound('request') ? app('request') : null;
        $memoKey = 'app-abilities:'.$user->id.':'.$organizationId;
        if ($request?->attributes->has($memoKey)) {
            return $request->attributes->get($memoKey);
        }
        $map = self::computeAppAbilitiesMap($user, $organizationId);
        $request?->attributes->set($memoKey, $map);

        return $map;
    }

    /** Forget memoised abilities after changing installs or app permissions mid-request. */
    public static function forgetAppAbilities(): void
    {
        $request = app()->bound('request') ? app('request') : null;
        foreach (array_keys($request?->attributes->all() ?? []) as $key) {
            if (str_starts_with($key, 'app-abilities:')) {
                $request->attributes->remove($key);
            }
        }
    }

    /** @return array<int, list<string>> */
    private static function computeAppAbilitiesMap(User $user, int $organizationId): array
    {
        $role = self::role($user, $organizationId);
        if (! $role) {
            return [];
        }

        $installed = OrganizationApp::where('organization_id', $organizationId)
            ->join('apps', 'apps.id', '=', 'organization_apps.app_id')
            ->pluck('apps.key', 'organization_apps.app_id');
        $overrides = in_array($role, AppCatalog::configurableRoles(), true)
            ? AppRolePermission::where('organization_id', $organizationId)->where('role', $role->value)->pluck('abilities', 'app_id')
            : collect();

        $map = [];
        foreach ($installed as $appId => $appKey) {
            $abilities = $overrides->has($appId)
                ? AppAbility::normalize($overrides[$appId] ?? [])
                : AppCatalog::defaultAbilities($role, $appKey);
            if ($abilities !== []) {
                $map[(int) $appId] = $abilities;
            }
        }

        return $map;
    }

    /** @return list<string> */
    public static function appAbilities(User $user, int $organizationId, LauncherApp $app): array
    {
        return self::appAbilitiesMap($user, $organizationId)[$app->id] ?? [];
    }

    public static function canUseApp(User $user, int $organizationId, LauncherApp $app, AppAbility $ability = AppAbility::View): bool
    {
        return in_array($ability->value, self::appAbilities($user, $organizationId, $app), true);
    }

    /**
     * Abilities in an app by key ([] when not installed or not allowed).
     *
     * @return list<string>
     */
    public static function appAbilitiesFor(User $user, int $organizationId, string $appKey): array
    {
        $id = LauncherApp::where('key', $appKey)->value('id');

        return $id ? (self::appAbilitiesMap($user, $organizationId)[$id] ?? []) : [];
    }

    public static function hasAppAbility(User $user, int $organizationId, string $appKey, AppAbility $ability = AppAbility::View): bool
    {
        return in_array($ability->value, self::appAbilitiesFor($user, $organizationId, $appKey), true);
    }

    /** Banners shown to members: active and inside their start/end window. */
    public static function visibleBannersQuery(User $user, int $organizationId): Builder
    {
        $query = LauncherBanner::query()->where('organization_id', $organizationId);
        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }

        return $query->where('is_active', true)
            ->where(fn (Builder $q) => $q->whereNull('starts_at')->orWhere('starts_at', '<=', now()))
            ->where(fn (Builder $q) => $q->whereNull('ends_at')->orWhere('ends_at', '>', now()));
    }

    public static function canViewBanner(User $user, LauncherBanner $banner): bool
    {
        if (! self::membership($user, $banner->organization_id)) {
            return false;
        }

        return $banner->isLive() || self::canManageApps($user, $banner->organization_id);
    }

    // --------------------------------------------------------------- Approvals
    //
    // A request is visible to its requester, to anyone who is or was an approver
    // on it (including the person who delegated), and to members with the
    // Approval app's "admin" ability. Approvers do not need the app itself.

    public static function canManageApprovalWorkflows(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'approval', AppAbility::Admin);
    }

    public static function canViewApprovalRequest(User $user, ApprovalRequest $request): bool
    {
        if (! self::membership($user, $request->organization_id)) {
            return false;
        }
        if ($request->requester_id === $user->id) {
            return true;
        }

        return ApprovalStepApprover::where('approval_request_id', $request->id)
            ->where(fn (Builder $q) => $q->where('user_id', $user->id)->orWhere('delegated_from', $user->id))
            ->exists()
            || self::canManageApprovalWorkflows($user, $request->organization_id);
    }

    public static function visibleApprovalRequestsQuery(User $user, int $organizationId): Builder
    {
        $query = ApprovalRequest::query()->where('approval_requests.organization_id', $organizationId);
        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::canManageApprovalWorkflows($user, $organizationId)) {
            return $query;
        }

        return $query->where(fn (Builder $q) => $q
            ->where('approval_requests.requester_id', $user->id)
            ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('approval_step_approvers')
                ->whereColumn('approval_step_approvers.approval_request_id', 'approval_requests.id')
                ->where(fn ($w) => $w->where('approval_step_approvers.user_id', $user->id)->orWhere('approval_step_approvers.delegated_from', $user->id))));
    }

    // ------------------------------------------------------------------- Forms
    //
    // Form app abilities: view = fill forms available to you and see your own
    // submissions; create = build forms (and manage your own); edit = manage
    // every form; delete = delete any form; admin = see every submission.

    public static function canBuildForms(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'form', AppAbility::Create);
    }

    public static function canManageForm(User $user, Form $form): bool
    {
        $abilities = self::appAbilitiesFor($user, $form->organization_id, 'form');

        return in_array('edit', $abilities, true)
            || ($form->created_by === $user->id && in_array('create', $abilities, true));
    }

    public static function canDeleteForm(User $user, Form $form): bool
    {
        $abilities = self::appAbilitiesFor($user, $form->organization_id, 'form');

        return in_array('delete', $abilities, true)
            || ($form->created_by === $user->id && in_array('create', $abilities, true));
    }

    /** Published, in the audience, and the role may use the Form app. */
    public static function canFillForm(User $user, Form $form): bool
    {
        return $form->isOpen()
            && self::hasAppAbility($user, $form->organization_id, 'form', AppAbility::View)
            && self::inFormAudience($user, $form);
    }

    public static function canViewForm(User $user, Form $form): bool
    {
        return self::canManageForm($user, $form) || self::canFillForm($user, $form);
    }

    public static function inFormAudience(User $user, Form $form): bool
    {
        $roles = $form->audience['roles'] ?? [];
        $departments = array_map('intval', $form->audience['department_ids'] ?? []);
        if ($roles === [] && $departments === []) {
            return true;
        }
        $role = self::role($user, $form->organization_id)?->value;
        if ($role && in_array($role, $roles, true)) {
            return true;
        }

        return $departments !== [] && DB::table('department_user')
            ->where('organization_id', $form->organization_id)
            ->where('user_id', $user->id)
            ->whereIn('department_id', $departments)
            ->exists();
    }

    /** Forms listed to a member: every form for form editors, otherwise their own plus those they can fill. */
    public static function visibleFormsQuery(User $user, int $organizationId): Builder
    {
        $query = Form::query()->where('forms.organization_id', $organizationId);
        $abilities = self::appAbilitiesFor($user, $organizationId, 'form');
        if (! in_array('view', $abilities, true) || ! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (in_array('edit', $abilities, true)) {
            return $query;
        }

        return $query->where(function (Builder $q) use ($user, $organizationId, $abilities) {
            if (in_array('create', $abilities, true)) {
                $q->where('forms.created_by', $user->id);
            }
            $q->orWhere(fn (Builder $open) => self::whereFillable($open, $user, $organizationId));
        });
    }

    /** Published forms the member can fill (SQL twin of canFillForm). */
    public static function fillableFormsQuery(User $user, int $organizationId): Builder
    {
        $query = Form::query()->where('forms.organization_id', $organizationId);
        if (! self::membership($user, $organizationId) || ! self::hasAppAbility($user, $organizationId, 'form')) {
            return $query->whereRaw('false');
        }

        return self::whereFillable($query, $user, $organizationId);
    }

    private static function whereFillable(Builder $query, User $user, int $organizationId): Builder
    {
        $role = self::role($user, $organizationId)?->value ?? '';

        return $query->where('forms.status', Form::STATUS_PUBLISHED)
            ->whereNotNull('forms.current_version_id')
            ->where(fn (Builder $a) => $a
                ->whereRaw("coalesce(jsonb_array_length(forms.audience->'roles'), 0) = 0 and coalesce(jsonb_array_length(forms.audience->'department_ids'), 0) = 0")
                ->orWhereRaw("jsonb_exists(coalesce(forms.audience->'roles', '[]'::jsonb), ?)", [$role])
                ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('department_user')
                    ->where('department_user.user_id', $user->id)
                    ->where('department_user.organization_id', $organizationId)
                    ->whereRaw("coalesce(forms.audience->'department_ids', '[]'::jsonb) @> to_jsonb(department_user.department_id)")));
    }

    public static function canViewSubmission(User $user, FormSubmission $submission): bool
    {
        if (! self::membership($user, $submission->organization_id)) {
            return false;
        }
        if ($submission->submitter_id === $user->id) {
            return true;
        }
        $form = $submission->relationLoaded('form') ? $submission->form : $submission->form()->first();
        if ($form && self::canManageForm($user, $form)) {
            return true;
        }
        if (self::hasAppAbility($user, $submission->organization_id, 'form', AppAbility::Admin)) {
            return true;
        }
        // Approvers of the submission's approval request.
        $request = $submission->approval_request_id ? ApprovalRequest::find($submission->approval_request_id) : null;

        return $request !== null && self::canViewApprovalRequest($user, $request);
    }

    // ------------------------------------------------------------- Opportunity
    //
    // Accounts and contacts are a shared directory for everyone with the app.
    // An opportunity is visible to its owner, the owner's current reporting
    // manager, and members with the Opportunity "edit" ability (sales managers;
    // Owners/Admins by default). Only the owner and "edit" members change it.

    public static function crmAbilities(User $user, int $organizationId): array
    {
        return self::membership($user, $organizationId) ? self::appAbilitiesFor($user, $organizationId, 'opportunity') : [];
    }

    public static function canUseCrm(User $user, int $organizationId): bool
    {
        return in_array('view', self::crmAbilities($user, $organizationId), true);
    }

    public static function canSeeAllOpportunities(User $user, int $organizationId): bool
    {
        return in_array('edit', self::crmAbilities($user, $organizationId), true);
    }

    public static function canCreateCrmRecords(User $user, int $organizationId): bool
    {
        return in_array('create', self::crmAbilities($user, $organizationId), true);
    }

    public static function canManagePipeline(User $user, int $organizationId): bool
    {
        return in_array('admin', self::crmAbilities($user, $organizationId), true);
    }

    public static function canViewOpportunity(User $user, Opportunity $opportunity): bool
    {
        if (! self::canUseCrm($user, $opportunity->organization_id)) {
            return false;
        }

        return $opportunity->owner_id === $user->id
            || self::canSeeAllOpportunities($user, $opportunity->organization_id)
            || ($opportunity->owner_id && ReportingLine::managerOf($opportunity->organization_id, $opportunity->owner_id) === $user->id);
    }

    public static function canEditOpportunity(User $user, Opportunity $opportunity): bool
    {
        return self::canUseCrm($user, $opportunity->organization_id)
            && ($opportunity->owner_id === $user->id || self::canSeeAllOpportunities($user, $opportunity->organization_id));
    }

    public static function canDeleteCrmRecords(User $user, int $organizationId): bool
    {
        return in_array('delete', self::crmAbilities($user, $organizationId), true);
    }

    /** SQL twin of canViewOpportunity. */
    public static function visibleOpportunitiesQuery(User $user, int $organizationId): Builder
    {
        $query = Opportunity::query()->where('crm_opportunities.organization_id', $organizationId);
        if (! self::canUseCrm($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::canSeeAllOpportunities($user, $organizationId)) {
            return $query;
        }

        return $query->where(fn (Builder $q) => $q->where('crm_opportunities.owner_id', $user->id)
            ->orWhereIn('crm_opportunities.owner_id', self::directReportIdsQuery($user, $organizationId)));
    }

    public static function canViewAccount(User $user, CrmAccount $account): bool
    {
        return self::canUseCrm($user, $account->organization_id);
    }

    /** Account owner, its creator, or "edit" members. */
    public static function canEditAccount(User $user, CrmAccount $account): bool
    {
        return self::canUseCrm($user, $account->organization_id)
            && ($account->owner_id === $user->id || $account->created_by === $user->id || self::canSeeAllOpportunities($user, $account->organization_id));
    }

    public static function canEditContact(User $user, CrmContact $contact): bool
    {
        if (! self::canUseCrm($user, $contact->organization_id)) {
            return false;
        }
        if ($contact->created_by === $user->id || self::canSeeAllOpportunities($user, $contact->organization_id)) {
            return true;
        }
        $account = $contact->account_id ? CrmAccount::find($contact->account_id) : null;

        return $account !== null && self::canEditAccount($user, $account);
    }

    /** Activities follow their opportunity; account-only activities follow the (shared) account. */
    public static function canViewCrmActivity(User $user, CrmActivity $activity): bool
    {
        if ($activity->opportunity_id) {
            $opportunity = Opportunity::find($activity->opportunity_id);

            return $opportunity !== null && self::canViewOpportunity($user, $opportunity);
        }

        return self::canUseCrm($user, $activity->organization_id);
    }

    public static function canEditCrmActivity(User $user, CrmActivity $activity): bool
    {
        return self::canViewCrmActivity($user, $activity)
            && ($activity->user_id === $user->id || self::canSeeAllOpportunities($user, $activity->organization_id));
    }

    // ---------------------------------------------------------------- Helpdesk
    //
    // A ticket is visible to its requester and to agents. Agents are members
    // listed in Helpdesk settings, plus roles with the Helpdesk "edit" ability
    // (Owners/Admins by default). Internal notes and their files are for agents only.

    public static function isHelpdeskAgent(User $user, int $organizationId): bool
    {
        $abilities = self::appAbilitiesFor($user, $organizationId, 'helpdesk');
        if (! in_array('view', $abilities, true)) {
            return false;
        }

        return in_array('edit', $abilities, true)
            || DB::table('helpdesk_agents')->where('organization_id', $organizationId)->where('user_id', $user->id)->exists();
    }

    public static function canManageHelpdesk(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'helpdesk', AppAbility::Admin);
    }

    public static function canRaiseTickets(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'helpdesk', AppAbility::Create);
    }

    public static function canViewTicket(User $user, Ticket $ticket): bool
    {
        if (! self::membership($user, $ticket->organization_id)) {
            return false;
        }

        return $ticket->requester_id === $user->id || self::isHelpdeskAgent($user, $ticket->organization_id);
    }

    public static function canDeleteTicket(User $user, Ticket $ticket): bool
    {
        return self::canViewTicket($user, $ticket)
            && self::hasAppAbility($user, $ticket->organization_id, 'helpdesk', AppAbility::Delete);
    }

    public static function canViewTicketMessage(User $user, TicketMessage $message): bool
    {
        $ticket = $message->relationLoaded('ticket') ? $message->ticket : $message->ticket()->first();

        return $ticket !== null && self::canViewTicket($user, $ticket)
            && (! $message->is_internal || self::isHelpdeskAgent($user, $ticket->organization_id));
    }

    public static function visibleTicketsQuery(User $user, int $organizationId): Builder
    {
        $query = Ticket::query()->where('helpdesk_tickets.organization_id', $organizationId);
        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::isHelpdeskAgent($user, $organizationId)) {
            return $query;
        }

        return $query->where('helpdesk_tickets.requester_id', $user->id);
    }

    // -------------------------------------------------------------- Timesheets
    //
    // A sheet is visible to its owner, to the owner's current reporting manager,
    // to participants of its approval request, and to members with the
    // Timesheet app's "admin" ability. Only the owner changes it.

    public static function canAdministerTimesheets(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'timesheet', AppAbility::Admin);
    }

    public static function canViewTimesheet(User $user, Timesheet $timesheet): bool
    {
        if (! self::membership($user, $timesheet->organization_id)) {
            return false;
        }
        if ($timesheet->user_id === $user->id || self::canAdministerTimesheets($user, $timesheet->organization_id)) {
            return true;
        }
        if (ReportingLine::managerOf($timesheet->organization_id, $timesheet->user_id) === $user->id) {
            return true;
        }
        $request = $timesheet->approval_request_id ? ApprovalRequest::find($timesheet->approval_request_id) : null;

        return $request !== null && self::canViewApprovalRequest($user, $request);
    }

    /** SQL twin of canViewTimesheet. */
    public static function visibleTimesheetsQuery(User $user, int $organizationId): Builder
    {
        $query = Timesheet::query()->where('timesheets.organization_id', $organizationId);
        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::canAdministerTimesheets($user, $organizationId)) {
            return $query;
        }
        $approvalAdmin = self::canManageApprovalWorkflows($user, $organizationId);

        return $query->where(fn (Builder $q) => $q
            ->where('timesheets.user_id', $user->id)
            ->orWhereIn('timesheets.user_id', self::directReportIdsQuery($user, $organizationId))
            ->when($approvalAdmin, fn (Builder $w) => $w->orWhereNotNull('timesheets.approval_request_id'))
            ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('approval_step_approvers')
                ->whereColumn('approval_step_approvers.approval_request_id', 'timesheets.approval_request_id')
                ->where(fn ($w) => $w->where('approval_step_approvers.user_id', $user->id)->orWhere('approval_step_approvers.delegated_from', $user->id))));
    }

    /** Members whose reporting manager is the user, in this organisation. */
    public static function directReportIdsQuery(User $user, int $organizationId): \Illuminate\Database\Query\Builder
    {
        return DB::table('organization_memberships')->select('user_id')
            ->where('organization_id', $organizationId)
            ->where('manager_id', $user->id);
    }

    /** Time can be logged to projects the member contributes to (not archived). */
    public static function canLogTimeToProject(User $user, Project $project): bool
    {
        return self::canContributeToProject($user, $project);
    }

    /** Projects whose hours the user may see in reports: every project for admins, otherwise those they manage. */
    public static function timesheetReportProjectIdsQuery(User $user, int $organizationId): \Illuminate\Database\Query\Builder
    {
        $query = DB::table('projects')->select('projects.id')->where('projects.organization_id', $organizationId);
        if (! self::membership($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::isAdmin($user, $organizationId)) {
            return $query;
        }

        return $query->where(fn ($q) => $q->where('projects.manager_id', $user->id)
            ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('project_members')
                ->whereColumn('project_members.project_id', 'projects.id')
                ->where('project_members.user_id', $user->id)
                ->where('project_members.role', 'manager')));
    }

    // ------------------------------------------------------------------- Leave
    //
    // Everyone with the Leave app applies for their own leave and sees the
    // leave calendar: who is away and when (approved leave of active members).
    // The leave type, reason and pending applications are visible only to the
    // applicant, their current reporting manager, participants of the approval
    // request and members with the Leave app's "admin" ability.

    public static function canUseLeave(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'leave');
    }

    public static function canAdministerLeave(User $user, int $organizationId): bool
    {
        return self::hasAppAbility($user, $organizationId, 'leave', AppAbility::Admin);
    }

    public static function canViewLeaveRequest(User $user, LeaveRequest $leave): bool
    {
        if (! self::canUseLeave($user, $leave->organization_id)) {
            return false;
        }
        if ($leave->user_id === $user->id || self::canAdministerLeave($user, $leave->organization_id)) {
            return true;
        }
        if (ReportingLine::managerOf($leave->organization_id, $leave->user_id) === $user->id) {
            return true;
        }
        $request = $leave->approval_request_id ? ApprovalRequest::find($leave->approval_request_id) : null;

        return $request !== null && self::canViewApprovalRequest($user, $request);
    }

    /** SQL twin of canViewLeaveRequest. */
    public static function visibleLeaveRequestsQuery(User $user, int $organizationId): Builder
    {
        $query = LeaveRequest::query()->where('leave_requests.organization_id', $organizationId);
        if (! self::canUseLeave($user, $organizationId)) {
            return $query->whereRaw('false');
        }
        if (self::canAdministerLeave($user, $organizationId)) {
            return $query;
        }
        $approvalAdmin = self::canManageApprovalWorkflows($user, $organizationId);

        return $query->where(fn (Builder $q) => $q
            ->where('leave_requests.user_id', $user->id)
            ->orWhereIn('leave_requests.user_id', self::directReportIdsQuery($user, $organizationId))
            ->when($approvalAdmin, fn (Builder $w) => $w->orWhereNotNull('leave_requests.approval_request_id'))
            ->orWhereExists(fn ($sub) => $sub->selectRaw('1')->from('approval_step_approvers')
                ->whereColumn('approval_step_approvers.approval_request_id', 'leave_requests.approval_request_id')
                ->where(fn ($w) => $w->where('approval_step_approvers.user_id', $user->id)->orWhere('approval_step_approvers.delegated_from', $user->id))));
    }

    /** A member's balances: the member, their current reporting manager and Leave admins. */
    public static function canViewLeaveBalances(User $user, int $organizationId, int $memberId): bool
    {
        if (! self::canUseLeave($user, $organizationId)) {
            return false;
        }

        return $memberId === $user->id
            || self::canAdministerLeave($user, $organizationId)
            || ReportingLine::managerOf($organizationId, $memberId) === $user->id;
    }

    // ----------------------------------------------------------------- Reports

    public static function canViewReports(User $user, int $organizationId): bool
    {
        return self::hasRole($user, $organizationId, Role::Manager);
    }
}
