<?php

namespace App\Models\Approval;

use App\Models\User;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** Out of office: approvals for the delegator go to the delegate during the period. */
class ApprovalDelegation extends Model
{
    protected $fillable = ['organization_id', 'delegator_id', 'delegate_id', 'starts_at', 'ends_at', 'reason', 'revoked_at'];

    protected function casts(): array
    {
        return ['starts_at' => 'datetime', 'ends_at' => 'datetime', 'revoked_at' => 'datetime'];
    }

    public function scopeActiveAt(Builder $query, DateTimeInterface $at): Builder
    {
        return $query->whereNull('revoked_at')->where('starts_at', '<=', $at)->where('ends_at', '>', $at);
    }

    public function delegator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'delegator_id');
    }

    public function delegate(): BelongsTo
    {
        return $this->belongsTo(User::class, 'delegate_id');
    }
}
