<?php

namespace App\Http\Resources\Leave;

use App\Http\Resources\UserSummaryResource;
use App\Models\Leave\LeaveRequest;
use App\Models\Organization;
use App\Support\Leave\Leaves;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * An application, for people who may see it (Permissions::canViewLeaveRequest).
 *
 * @mixin LeaveRequest
 */
class LeaveRequestResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $mine = $this->user_id === $request->user()->id;
        $organization = $request->route('organization');
        $today = ($organization instanceof Organization ? Leaves::today($organization) : now())->toDateString();

        return [
            'id' => $this->id,
            'user' => $this->whenLoaded('user', fn () => new UserSummaryResource($this->user)),
            'type' => $this->whenLoaded('type', fn () => ['id' => $this->type->id, 'key' => $this->type->key, 'name' => $this->type->name, 'color' => $this->type->color]),
            'start_date' => $this->start_date->toDateString(),
            'end_date' => $this->end_date->toDateString(),
            'half_day' => $this->half_day,
            'days' => $this->days,
            'reason' => $this->reason,
            'status' => $this->status,
            'approval_request_id' => $this->approval_request_id,
            'submitted_at' => $this->submitted_at?->toIso8601String(),
            'cancelled_at' => $this->cancelled_at?->toIso8601String(),
            'created_at' => $this->created_at?->toIso8601String(),
            'permissions' => [
                'edit' => $mine && $this->status === LeaveRequest::STATUS_RETURNED,
                'cancel' => $mine && (in_array($this->status, LeaveRequest::OPEN, true)
                    || ($this->status === LeaveRequest::STATUS_APPROVED && $this->start_date->toDateString() > $today)),
            ],
        ];
    }
}
