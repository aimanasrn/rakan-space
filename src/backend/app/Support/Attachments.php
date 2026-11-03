<?php

namespace App\Support;

use App\Models\Attachment;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

class Attachments
{
    /**
     * Links pending uploads to a parent resource. Only the uploader's own,
     * still-unattached files from the same organisation are accepted, so a
     * client cannot claim someone else's file or move files between parents.
     *
     * @param  array<int>  $ids
     */
    public static function attach(User $user, Organization $organization, array $ids, Model $parent): void
    {
        $ids = array_values(array_unique(array_map('intval', $ids)));
        if ($ids === []) {
            return;
        }

        $count = Attachment::query()
            ->whereIn('id', $ids)
            ->where('organization_id', $organization->id)
            ->where('uploader_id', $user->id)
            ->whereNull('attachable_type')
            ->update([
                'attachable_type' => $parent->getMorphClass(),
                'attachable_id' => $parent->getKey(),
            ]);

        if ($count !== count($ids)) {
            throw ValidationException::withMessages(['attachment_ids' => 'One or more attachments are invalid or already used.']);
        }
    }

    /**
     * Attachments the user can currently access, computed in SQL from the
     * same rules as Permissions::canViewAttachment.
     */
    public static function visibleQuery(User $user, int $organizationId): Builder
    {
        $projects = Permissions::visibleProjectsQuery($user, $organizationId)->select('id');
        $conversations = Permissions::visibleConversationsQuery($user, $organizationId)->select('id');
        $announcements = Permissions::visibleAnnouncementsQuery($user, $organizationId)->select('id');

        return Attachment::query()
            ->where('attachments.organization_id', $organizationId)
            ->where(function (Builder $q) use ($projects, $conversations, $announcements) {
                $q->where(fn ($w) => $w->where('attachable_type', 'project')->whereIn('attachable_id', $projects))
                    ->orWhere(fn ($w) => $w->where('attachable_type', 'task')->whereIn('attachable_id',
                        DB::table('tasks')->select('id')->whereIn('project_id', $projects)))
                    ->orWhere(fn ($w) => $w->where('attachable_type', 'message')->whereIn('attachable_id',
                        DB::table('messages')->select('id')->whereNull('deleted_at')->whereIn('conversation_id', $conversations)))
                    ->orWhere(fn ($w) => $w->where('attachable_type', 'announcement')->whereIn('attachable_id', $announcements));
            });
    }
}
