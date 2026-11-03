<?php

namespace App\Http\Resources\Approval;

use App\Http\Resources\UserSummaryResource;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalRequestStep;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * List shape by default; the controller adds detail (steps, history,
 * permissions) for the single-request endpoint via ->withDetail().
 */
class ApprovalRequestResource extends JsonResource
{
    private bool $detail = false;

    public function withDetail(): static
    {
        $this->detail = true;

        return $this;
    }

    public function toArray(Request $request): array
    {
        $viewer = $request->user();
        /** @var ApprovalRequestStep|null $current */
        $current = $this->relationLoaded('allSteps')
            ? $this->allSteps->first(fn ($s) => $s->round === $this->round && $s->status === ApprovalRequestStep::STATUS_PENDING)
            : null;

        $base = [
            'id' => $this->id,
            'title' => $this->title,
            'summary' => $this->summary,
            'status' => $this->status,
            'entity_type' => $this->entity_type,
            'entity_id' => $this->entity_id,
            'link' => $this->link,
            'round' => $this->round,
            'requester' => $this->whenLoaded('requester', fn () => new UserSummaryResource($this->requester)),
            'workflow' => $this->whenLoaded('workflow', fn () => $this->workflow ? ['id' => $this->workflow->id, 'name' => $this->workflow->name] : null),
            'current_step' => $current ? [
                'id' => $current->id,
                'name' => $current->name,
                'position' => $current->position,
                'due_at' => $current->dueAt()?->toIso8601String(),
                'overdue' => (bool) $current->dueAt()?->isPast(),
                'waiting_on' => $current->relationLoaded('assignees')
                    ? $current->assignees->whereNull('decision')->map(fn ($a) => $a->user?->name)->filter()->values()
                    : [],
            ] : null,
            'my_turn' => $current && $viewer && $current->relationLoaded('assignees')
                && $current->assignees->contains(fn ($a) => $a->user_id === $viewer->id && $a->decision === null),
            'submitted_at' => $this->submitted_at?->toIso8601String(),
            'completed_at' => $this->completed_at?->toIso8601String(),
        ];

        if (! $this->detail) {
            return $base;
        }

        return [
            ...$base,
            'data' => $this->data ?? (object) [],
            'rounds' => $this->allSteps->groupBy('round')->map(fn ($steps, $round) => [
                'round' => (int) $round,
                'steps' => $steps->map(fn ($s) => [
                    'id' => $s->id,
                    'position' => $s->position,
                    'name' => $s->name,
                    'mode' => $s->mode,
                    'status' => $s->status,
                    'condition' => $s->condition,
                    'activated_at' => $s->activated_at?->toIso8601String(),
                    'completed_at' => $s->completed_at?->toIso8601String(),
                    'due_at' => $s->dueAt()?->toIso8601String(),
                    'approvers' => $s->assignees->map(fn ($a) => [
                        'user' => $a->user ? new UserSummaryResource($a->user) : null,
                        'source' => $a->source,
                        'delegated_from' => $a->delegator ? new UserSummaryResource($a->delegator) : null,
                        'decision' => $a->decision,
                        'comment' => $a->comment,
                        'decided_at' => $a->decided_at?->toIso8601String(),
                    ])->values(),
                ])->values(),
            ])->values(),
            'history' => $this->actions->map(fn ($a) => [
                'id' => $a->id,
                'action' => $a->action,
                'actor' => $a->actor ? new UserSummaryResource($a->actor) : null,
                'comment' => $a->comment,
                'step' => $a->approval_request_step_id ? $this->allSteps->firstWhere('id', $a->approval_request_step_id)?->name : null,
                'properties' => $a->properties,
                'created_at' => $a->created_at?->toIso8601String(),
            ])->values(),
            'permissions' => [
                'decide' => $base['my_turn'],
                'resubmit' => $viewer && $this->requester_id === $viewer->id && $this->status === ApprovalRequest::STATUS_RETURNED,
                'cancel' => $viewer && $this->requester_id === $viewer->id
                    && in_array($this->status, [ApprovalRequest::STATUS_PENDING, ApprovalRequest::STATUS_RETURNED], true),
            ],
        ];
    }
}
