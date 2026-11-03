<?php

namespace App\Support;

use App\Enums\Role;
use App\Models\Announcement;
use App\Models\Attachment;
use App\Models\Conversation;
use App\Models\Event;
use App\Models\Message;
use App\Models\OrganizationMembership;
use App\Models\Project;
use App\Models\Task;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;

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

    // ----------------------------------------------------------------- Reports

    public static function canViewReports(User $user, int $organizationId): bool
    {
        return self::hasRole($user, $organizationId, Role::Manager);
    }
}
