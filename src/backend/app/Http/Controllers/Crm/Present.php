<?php

namespace App\Http\Controllers\Crm;

use App\Http\Resources\UserSummaryResource;
use App\Models\Crm\Account;
use App\Models\Crm\Activity;
use App\Models\Crm\Contact;
use App\Models\Crm\Opportunity;
use App\Models\User;
use App\Support\Permissions;

/** JSON shapes for the Opportunity app. */
class Present
{
    public static function user(?User $user): ?array
    {
        return $user ? (new UserSummaryResource($user))->resolve() : null;
    }

    public static function opportunity(Opportunity $o, User $viewer): array
    {
        return [
            'id' => $o->id,
            'name' => $o->name,
            'amount' => (float) $o->amount,
            'stage_id' => $o->stage_id,
            'account' => $o->account ? ['id' => $o->account->id, 'name' => $o->account->name] : null,
            'contact' => $o->contact ? ['id' => $o->contact->id, 'name' => $o->contact->name] : null,
            'owner' => self::user($o->owner),
            'expected_close_date' => $o->expected_close_date?->toDateString(),
            'lost_reason' => $o->lost_reason,
            'closed_at' => $o->closed_at?->toIso8601String(),
            'position' => $o->position,
            'updated_at' => $o->updated_at?->toIso8601String(),
            'permissions' => ['edit' => Permissions::canEditOpportunity($viewer, $o)],
        ];
    }

    public static function account(Account $a, User $viewer): array
    {
        return [
            'id' => $a->id,
            'name' => $a->name,
            'industry' => $a->industry,
            'website' => $a->website,
            'phone' => $a->phone,
            'address' => $a->address,
            'notes' => $a->notes,
            'owner' => self::user($a->owner),
            'contacts_count' => $a->contacts_count ?? null,
            'updated_at' => $a->updated_at?->toIso8601String(),
            'permissions' => [
                'edit' => Permissions::canEditAccount($viewer, $a),
                'delete' => Permissions::canDeleteCrmRecords($viewer, $a->organization_id),
            ],
        ];
    }

    public static function contact(Contact $c, User $viewer): array
    {
        return [
            'id' => $c->id,
            'name' => $c->name,
            'email' => $c->email,
            'phone' => $c->phone,
            'job_title' => $c->job_title,
            'account' => $c->account ? ['id' => $c->account->id, 'name' => $c->account->name] : null,
            'permissions' => [
                'edit' => Permissions::canEditContact($viewer, $c),
                'delete' => Permissions::canDeleteCrmRecords($viewer, $c->organization_id),
            ],
        ];
    }

    public static function activity(Activity $a, User $viewer): array
    {
        return [
            'id' => $a->id,
            'type' => $a->type,
            'subject' => $a->subject,
            'body' => $a->body,
            'due_at' => $a->due_at?->toIso8601String(),
            'done_at' => $a->done_at?->toIso8601String(),
            'user' => self::user($a->user),
            'opportunity' => $a->opportunity ? ['id' => $a->opportunity->id, 'name' => $a->opportunity->name] : null,
            'account' => $a->account ? ['id' => $a->account->id, 'name' => $a->account->name] : null,
            'created_at' => $a->created_at->toIso8601String(),
            'permissions' => ['edit' => Permissions::canEditCrmActivity($viewer, $a)],
        ];
    }
}
