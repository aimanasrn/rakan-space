<?php

namespace App\Http\Resources\Helpdesk;

use App\Http\Resources\UserSummaryResource;
use App\Models\Helpdesk\Ticket;
use Carbon\CarbonInterface;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/** @mixin Ticket */
class TicketResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'reference' => $this->reference(),
            'subject' => $this->subject,
            'status' => $this->status,
            'priority' => $this->priority,
            'category' => $this->category,
            'requester' => $this->whenLoaded('requester', fn () => new UserSummaryResource($this->requester)),
            'assignee' => $this->whenLoaded('assignee', fn () => $this->assignee ? new UserSummaryResource($this->assignee) : null),
            'sla' => [
                'first_response' => self::sla($this->first_response_due_at, $this->first_responded_at, $this->isActive()),
                'resolution' => self::sla($this->resolution_due_at, $this->resolved_at, $this->isActive()),
            ],
            'replies_count' => $this->whenCounted('public_messages_count', fn () => $this->public_messages_count),
            'created_at' => $this->created_at?->toIso8601String(),
            'last_activity_at' => $this->last_activity_at?->toIso8601String(),
            'resolved_at' => $this->resolved_at?->toIso8601String(),
            'closed_at' => $this->closed_at?->toIso8601String(),
        ];
    }

    /**
     * met | missed | due_soon (within the hour) | pending | none.
     *
     * @return array{due_at: string|null, met_at: string|null, state: string}
     */
    public static function sla(?CarbonInterface $due, ?CarbonInterface $metAt, bool $active): array
    {
        $state = match (true) {
            ! $due => 'none',
            $metAt !== null => $metAt->lte($due) ? 'met' : 'missed',
            ! $active => 'none',
            $due->lte(now()) => 'missed',
            $due->lte(now()->addHour()) => 'due_soon',
            default => 'pending',
        };

        return ['due_at' => $due?->toIso8601String(), 'met_at' => $metAt?->toIso8601String(), 'state' => $state];
    }
}
