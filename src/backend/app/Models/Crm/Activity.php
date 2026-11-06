<?php

namespace App\Models\Crm;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/** A note, call, meeting, email or follow-up task on an opportunity or account. */
class Activity extends Model
{
    protected $table = 'crm_activities';

    public const TYPES = ['note', 'call', 'meeting', 'email', 'task'];

    protected $fillable = ['organization_id', 'opportunity_id', 'account_id', 'type', 'subject', 'body', 'due_at', 'done_at', 'user_id'];

    protected function casts(): array
    {
        return ['due_at' => 'datetime', 'done_at' => 'datetime'];
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function opportunity(): BelongsTo
    {
        return $this->belongsTo(Opportunity::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}
