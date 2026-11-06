<?php

namespace App\Support\Helpdesk;

use App\Models\AppRolePermission;
use App\Models\Helpdesk\HelpdeskSetting;
use App\Models\Helpdesk\Ticket;
use App\Models\Helpdesk\TicketMessage;
use App\Models\LauncherApp;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\User;
use App\Support\ActivityLog;
use App\Support\AppCatalog;
use App\Support\Attachments;
use App\Support\Notifier;
use App\Support\Permissions;
use Carbon\CarbonInterface;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;
use Symfony\Component\HttpKernel\Exception\HttpException;

/**
 * Ticket lifecycle. Controllers check that the user can see the ticket;
 * this class enforces who may do what to it (agent vs requester).
 */
class Helpdesk
{
    public static function settings(Organization|int $organization): HelpdeskSetting
    {
        $id = $organization instanceof Organization ? $organization->id : $organization;
        HelpdeskSetting::query()->insertOrIgnore(['organization_id' => $id, 'created_at' => now(), 'updated_at' => now()]);

        return HelpdeskSetting::where('organization_id', $id)->firstOrFail();
    }

    /**
     * Who hears about new, unassigned tickets: the agents listed in settings,
     * or (when nobody is listed) everyone whose role makes them an agent.
     *
     * @return list<int>
     */
    public static function queueRecipientIds(int $organizationId): array
    {
        return self::agentIds($organizationId, listedOnly: true) ?: self::agentIds($organizationId);
    }

    /**
     * Active members who can work tickets (same rule as Permissions::isHelpdeskAgent):
     * listed agents plus roles with the Helpdesk "edit" ability.
     *
     * @return list<int>
     */
    public static function agentIds(int $organizationId, bool $listedOnly = false): array
    {
        $listed = DB::table('helpdesk_agents')->where('organization_id', $organizationId)->pluck('user_id')->all();
        $members = OrganizationMembership::where('organization_id', $organizationId)
            ->where('status', OrganizationMembership::STATUS_ACTIVE)->get(['user_id', 'role']);

        $roleIsAgent = [];
        $roleCanView = [];
        $app = LauncherApp::where('key', 'helpdesk')->first();
        $installed = $app && DB::table('organization_apps')->where('organization_id', $organizationId)->where('app_id', $app->id)->exists();
        if (! $installed) {
            return [];
        }
        $overrides = AppRolePermission::where('organization_id', $organizationId)->where('app_id', $app->id)->pluck('abilities', 'role');
        foreach ($members->pluck('role')->unique() as $role) {
            $abilities = $overrides->has($role->value) && in_array($role, AppCatalog::configurableRoles(), true)
                ? $overrides[$role->value] ?? []
                : AppCatalog::defaultAbilities($role, 'helpdesk');
            $roleCanView[$role->value] = $abilities !== [];
            $roleIsAgent[$role->value] = in_array('edit', $abilities, true);
        }

        $ids = $members->filter(fn ($m) => $roleCanView[$m->role->value]
            && (in_array($m->user_id, $listed) || (! $listedOnly && $roleIsAgent[$m->role->value])));

        return $ids->pluck('user_id')->map(fn ($id) => (int) $id)->values()->all();
    }

    /** @return array{0: CarbonInterface, 1: CarbonInterface} first response and resolution due times */
    public static function dueTimes(int $organizationId, string $priority, CarbonInterface $from): array
    {
        $policy = self::settings($organizationId)->slaPolicy()[$priority];

        return [
            $from->copy()->addHours((int) $policy['first_response_hours']),
            $from->copy()->addHours((int) $policy['resolution_hours']),
        ];
    }

    /**
     * @param  array{subject: string, description: string, priority?: string, category?: string|null, requester_id?: int|null, assignee_id?: int|null, attachment_ids?: list<int>}  $data
     */
    public static function create(Organization $organization, User $actor, array $data): Ticket
    {
        $isAgent = Permissions::isHelpdeskAgent($actor, $organization->id);
        $requesterId = $actor->id;
        if (! empty($data['requester_id']) && (int) $data['requester_id'] !== $actor->id) {
            if (! $isAgent) {
                throw ValidationException::withMessages(['requester_id' => 'Only agents can raise tickets for someone else.']);
            }
            $requesterId = $organization->filterActiveMemberIds([$data['requester_id']])[0]
                ?? throw ValidationException::withMessages(['requester_id' => 'Choose an active member.']);
        }
        $assigneeId = null;
        if (! empty($data['assignee_id'])) {
            if (! $isAgent) {
                throw ValidationException::withMessages(['assignee_id' => 'Only agents can assign tickets.']);
            }
            $assigneeId = self::validAgent($organization->id, (int) $data['assignee_id']);
        }
        $priority = $data['priority'] ?? 'medium';
        self::validCategory($organization->id, $data['category'] ?? null);

        return DB::transaction(function () use ($organization, $actor, $data, $requesterId, $assigneeId, $priority) {
            [$firstDue, $resolveDue] = self::dueTimes($organization->id, $priority, now());
            $ticket = Ticket::create([
                'organization_id' => $organization->id,
                'subject' => trim($data['subject']),
                'description' => trim($data['description']),
                'priority' => $priority,
                'category' => $data['category'] ?? null,
                'requester_id' => $requesterId,
                'assignee_id' => $assigneeId,
                'created_by' => $actor->id,
                'status' => $assigneeId ? Ticket::STATUS_IN_PROGRESS : Ticket::STATUS_OPEN,
                'first_response_due_at' => $firstDue,
                'resolution_due_at' => $resolveDue,
                'last_activity_at' => now(),
            ]);
            Attachments::attach($actor, $organization, $data['attachment_ids'] ?? [], $ticket);
            ActivityLog::record($organization->id, $actor, 'helpdesk.created', $ticket, ['priority' => $priority]);

            $title = 'New ticket '.$ticket->reference().': '.$ticket->subject;
            if ($assigneeId) {
                self::notifyAssigned($ticket, $actor);
            } else {
                Notifier::send($organization->id, self::queueRecipientIds($organization->id), 'helpdesk.created', $title,
                    ucfirst($priority).' priority · from '.($ticket->requester?->name ?? 'a member'), $ticket->link(), $actor->id, 'helpdesk-created:'.$ticket->id);
            }
            if ($requesterId !== $actor->id) {
                Notifier::send($organization->id, [$requesterId], 'helpdesk.created', $actor->name.' raised a ticket for you: '.$ticket->subject,
                    $ticket->reference(), $ticket->link(), $actor->id, 'helpdesk-created-for:'.$ticket->id);
            }

            return $ticket->fresh();
        });
    }

    /**
     * Agents change status, priority, category, assignee and subject.
     * Requesters may only mark their own ticket resolved.
     *
     * @param  array{status?: string, priority?: string, category?: string|null, assignee_id?: int|null, subject?: string}  $changes
     */
    public static function update(Ticket $ticket, User $actor, array $changes): Ticket
    {
        $isAgent = Permissions::isHelpdeskAgent($actor, $ticket->organization_id);
        if (! $isAgent) {
            $onlyResolving = array_keys($changes) === ['status'] && $changes['status'] === Ticket::STATUS_RESOLVED;
            if ($ticket->requester_id !== $actor->id || ! $onlyResolving) {
                throw new HttpException(403, 'Only agents can change this ticket.');
            }
        }
        if (array_key_exists('assignee_id', $changes) && $changes['assignee_id']) {
            $changes['assignee_id'] = self::validAgent($ticket->organization_id, (int) $changes['assignee_id']);
        }
        if (array_key_exists('category', $changes)) {
            self::validCategory($ticket->organization_id, $changes['category']);
        }

        return DB::transaction(function () use ($ticket, $actor, $changes, $isAgent) {
            $ticket = Ticket::whereKey($ticket->id)->lockForUpdate()->firstOrFail();
            if ($ticket->status === Ticket::STATUS_CLOSED && (! $isAgent || ! isset($changes['status']) || $changes['status'] === Ticket::STATUS_CLOSED)) {
                throw new HttpException(422, $isAgent ? 'This ticket is closed. Reopen it first.' : 'This ticket is closed.');
            }
            $before = $ticket->only(['status', 'priority', 'category', 'assignee_id', 'subject']);

            foreach (['subject', 'category', 'assignee_id'] as $field) {
                if (array_key_exists($field, $changes)) {
                    $ticket->{$field} = $field === 'subject' ? trim((string) $changes[$field]) : $changes[$field];
                }
            }
            if (isset($changes['priority']) && $changes['priority'] !== $ticket->priority) {
                $ticket->priority = $changes['priority'];
                // Targets move with the priority, counted from when the ticket was raised.
                [$firstDue, $resolveDue] = self::dueTimes($ticket->organization_id, $ticket->priority, $ticket->created_at);
                $ticket->first_response_due_at = $firstDue;
                $ticket->resolution_due_at = $resolveDue;
            }
            if (isset($changes['status'])) {
                self::applyStatus($ticket, $changes['status']);
            } elseif ($ticket->isDirty('assignee_id') && $ticket->assignee_id && $ticket->status === Ticket::STATUS_OPEN) {
                $ticket->status = Ticket::STATUS_IN_PROGRESS;
            }
            $ticket->last_activity_at = now();
            $ticket->save();

            $after = $ticket->only(array_keys($before));
            $changed = array_keys(array_diff_assoc(array_map('strval', $after), array_map('strval', $before)));
            foreach ($changed as $field) {
                ActivityLog::record($ticket->organization_id, $actor, 'helpdesk.'.$field.'_changed', $ticket, ['from' => $before[$field], 'to' => $after[$field]]);
            }

            if (in_array('assignee_id', $changed, true) && $ticket->assignee_id) {
                self::notifyAssigned($ticket, $actor);
            }
            if (in_array('status', $changed, true) && in_array($ticket->status, [Ticket::STATUS_RESOLVED, Ticket::STATUS_CLOSED], true)) {
                Notifier::send($ticket->organization_id, [$ticket->requester_id], 'helpdesk.'.$ticket->status,
                    ucfirst($ticket->status).': '.$ticket->subject,
                    $ticket->status === Ticket::STATUS_RESOLVED ? 'Reply if the problem is not fixed and the ticket reopens.' : null,
                    $ticket->link(), $actor->id, 'helpdesk-'.$ticket->status.':'.$ticket->id.':'.now()->timestamp);
            }

            return $ticket->fresh();
        });
    }

    /** Public reply or (agents only) internal note. */
    public static function reply(Ticket $ticket, User $actor, string $body, bool $internal = false, ?string $status = null, array $attachmentIds = []): TicketMessage
    {
        $isAgent = Permissions::isHelpdeskAgent($actor, $ticket->organization_id);
        if (($internal || $status !== null) && ! $isAgent) {
            throw new HttpException(403, 'Only agents can add internal notes or change the status.');
        }
        $body = trim($body);
        if ($body === '') {
            throw ValidationException::withMessages(['body' => 'Write a message.']);
        }

        return DB::transaction(function () use ($ticket, $actor, $body, $internal, $status, $attachmentIds, $isAgent) {
            $ticket = Ticket::whereKey($ticket->id)->lockForUpdate()->firstOrFail();
            if ($ticket->status === Ticket::STATUS_CLOSED) {
                throw new HttpException(422, 'This ticket is closed. Raise a new ticket if you still need help.');
            }

            $message = TicketMessage::create([
                'organization_id' => $ticket->organization_id, 'ticket_id' => $ticket->id,
                'author_id' => $actor->id, 'body' => $body, 'is_internal' => $internal,
            ]);
            Attachments::attach($actor, $ticket->organization()->firstOrFail(), $attachmentIds, $message);

            $fromRequester = $actor->id === $ticket->requester_id;
            $statusBefore = $ticket->status;
            if ($status !== null) {
                self::applyStatus($ticket, $status);
            } elseif (! $internal && $fromRequester && in_array($ticket->status, [Ticket::STATUS_WAITING, Ticket::STATUS_RESOLVED], true)) {
                // The requester answered or says it is not fixed: back to the agents.
                self::applyStatus($ticket, $ticket->assignee_id ? Ticket::STATUS_IN_PROGRESS : Ticket::STATUS_OPEN);
            } elseif (! $internal && $isAgent && ! $fromRequester && $ticket->status === Ticket::STATUS_OPEN) {
                self::applyStatus($ticket, Ticket::STATUS_IN_PROGRESS);
            }
            if (! $internal && $isAgent && ! $fromRequester && ! $ticket->first_responded_at) {
                $ticket->first_responded_at = now();
            }
            $ticket->last_activity_at = now();
            $ticket->save();
            if ($ticket->status !== $statusBefore) {
                ActivityLog::record($ticket->organization_id, $actor, 'helpdesk.status_changed', $ticket, ['from' => $statusBefore, 'to' => $ticket->status]);
            }

            // Who hears about it: never the author; internal notes never reach the requester.
            if ($internal) {
                $to = array_filter([$ticket->assignee_id]);
            } elseif ($fromRequester) {
                $to = $ticket->assignee_id ? [$ticket->assignee_id] : self::queueRecipientIds($ticket->organization_id);
            } else {
                $to = [$ticket->requester_id];
            }
            Notifier::send($ticket->organization_id, $to, $internal ? 'helpdesk.note' : 'helpdesk.reply',
                ($internal ? 'Internal note on ' : 'New reply on ').$ticket->reference().': '.$ticket->subject,
                $actor->name.($ticket->status !== $statusBefore ? ' · status: '.str_replace('_', ' ', $ticket->status) : ''),
                $ticket->link(), $actor->id, 'helpdesk-message:'.$message->id);

            return $message;
        });
    }

    /**
     * SLA warnings (one hour before) and breaches, sent to the assignee or the
     * agents, and auto-closing of resolved tickets. Each notice is sent once
     * per due time (a priority change sets new due times).
     *
     * @return array{warned: int, breached: int, closed: int}
     */
    public static function processSla(?CarbonInterface $now = null): array
    {
        $now ??= now();
        $result = ['warned' => 0, 'breached' => 0, 'closed' => 0];
        $agents = [];

        Ticket::query()->whereIn('status', Ticket::ACTIVE)
            ->where(fn ($q) => $q
                ->where(fn ($w) => $w->whereNull('first_responded_at')->where('first_response_due_at', '<=', $now->copy()->addHour()))
                ->orWhere('resolution_due_at', '<=', $now->copy()->addHour()))
            ->chunkById(200, function ($tickets) use ($now, &$result, &$agents) {
                foreach ($tickets as $ticket) {
                    $checks = [['resolution', $ticket->resolution_due_at]];
                    if (! $ticket->first_responded_at) {
                        $checks[] = ['first response', $ticket->first_response_due_at];
                    }
                    foreach ($checks as [$kind, $due]) {
                        if (! $due || $due->gt($now->copy()->addHour())) {
                            continue;
                        }
                        $breached = $due->lte($now);
                        $to = $ticket->assignee_id ? [$ticket->assignee_id] : ($agents[$ticket->organization_id] ??= self::queueRecipientIds($ticket->organization_id));
                        Notifier::send($ticket->organization_id, $to, $breached ? 'helpdesk.sla_breached' : 'helpdesk.sla_warning',
                            ($breached ? 'SLA missed: ' : 'SLA due soon: ').$ticket->reference().' '.$ticket->subject,
                            ucfirst($kind).' target '.($breached ? 'passed' : 'is within the hour').'.', $ticket->link(), null,
                            'helpdesk-sla:'.$ticket->id.':'.$kind.':'.($breached ? 'breach' : 'warn').':'.$due->timestamp);
                        $result[$breached ? 'breached' : 'warned']++;
                    }
                }
            });

        // Auto-close resolved tickets after the configured quiet period.
        HelpdeskSetting::query()->where('auto_close_days', '>', 0)->get()->each(function (HelpdeskSetting $settings) use ($now, &$result) {
            $stale = Ticket::where('organization_id', $settings->organization_id)
                ->where('status', Ticket::STATUS_RESOLVED)
                ->where('resolved_at', '<=', $now->copy()->subDays($settings->auto_close_days))
                ->get();
            foreach ($stale as $ticket) {
                $ticket->update(['status' => Ticket::STATUS_CLOSED, 'closed_at' => $now]);
                ActivityLog::record($ticket->organization_id, null, 'helpdesk.status_changed', $ticket, ['from' => 'resolved', 'to' => 'closed', 'auto' => true]);
                $result['closed']++;
            }
        });

        return $result;
    }

    /** A member leaves: their assigned, still-active tickets go back to the queue. */
    public static function removeMember(int $organizationId, int $userId): void
    {
        DB::table('helpdesk_agents')->where('organization_id', $organizationId)->where('user_id', $userId)->delete();
        Ticket::where('organization_id', $organizationId)->where('assignee_id', $userId)
            ->whereIn('status', Ticket::ACTIVE)
            ->update(['assignee_id' => null, 'status' => DB::raw("case when status = 'in_progress' then 'open' else status end")]);
    }

    // ---------------------------------------------------------------- internals

    private static function applyStatus(Ticket $ticket, string $status): void
    {
        if (! in_array($status, Ticket::STATUSES, true)) {
            throw ValidationException::withMessages(['status' => 'Unknown status.']);
        }
        $ticket->status = $status;
        if ($status === Ticket::STATUS_RESOLVED) {
            $ticket->resolved_at = now();
            $ticket->closed_at = null;
        } elseif ($status === Ticket::STATUS_CLOSED) {
            $ticket->resolved_at ??= now();
            $ticket->closed_at = now();
        } else {
            $ticket->resolved_at = null;
            $ticket->closed_at = null;
        }
    }

    private static function notifyAssigned(Ticket $ticket, User $actor): void
    {
        Notifier::send($ticket->organization_id, [$ticket->assignee_id], 'helpdesk.assigned',
            'Ticket assigned to you: '.$ticket->subject, $ticket->reference().' · '.ucfirst($ticket->priority).' priority',
            $ticket->link(), $actor->id, 'helpdesk-assigned:'.$ticket->id.':'.$ticket->assignee_id);
    }

    private static function validAgent(int $organizationId, int $userId): int
    {
        if (! in_array($userId, self::agentIds($organizationId), true)) {
            throw ValidationException::withMessages(['assignee_id' => 'Choose a Helpdesk agent.']);
        }

        return $userId;
    }

    private static function validCategory(int $organizationId, ?string $category): void
    {
        if ($category !== null && $category !== '' && ! in_array($category, self::settings($organizationId)->categoryList(), true)) {
            throw ValidationException::withMessages(['category' => 'Choose one of the categories.']);
        }
    }
}
