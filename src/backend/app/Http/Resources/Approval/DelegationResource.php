<?php

namespace App\Http\Resources\Approval;

use App\Http\Resources\UserSummaryResource;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

class DelegationResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        $now = now();

        return [
            'id' => $this->id,
            'delegator' => new UserSummaryResource($this->delegator),
            'delegate' => new UserSummaryResource($this->delegate),
            'starts_at' => $this->starts_at->toIso8601String(),
            'ends_at' => $this->ends_at->toIso8601String(),
            'reason' => $this->reason,
            'status' => $this->revoked_at ? 'revoked' : ($this->ends_at->lte($now) ? 'ended' : ($this->starts_at->gt($now) ? 'scheduled' : 'active')),
            'can_revoke' => ! $this->revoked_at && $this->ends_at->gt($now) && $this->delegator_id === $request->user()->id,
        ];
    }
}
