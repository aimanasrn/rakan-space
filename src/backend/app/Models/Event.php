<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;

class Event extends Model
{
    public const AUDIENCE_EVERYONE = 'everyone';

    public const AUDIENCE_PARTICIPANTS = 'participants';

    protected $fillable = [
        'organization_id', 'title', 'description', 'location', 'meeting_url',
        'starts_at', 'ends_at', 'audience', 'reminder_minutes', 'created_by',
    ];

    protected function casts(): array
    {
        return ['starts_at' => 'datetime', 'ends_at' => 'datetime', 'reminder_minutes' => 'integer'];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function participants(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'event_participants')->withTimestamps();
    }
}
