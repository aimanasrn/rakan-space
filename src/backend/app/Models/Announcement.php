<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class Announcement extends Model
{
    public const AUDIENCE_ORGANIZATION = 'organization';

    public const AUDIENCE_DEPARTMENT = 'department';

    protected $fillable = [
        'organization_id', 'author_id', 'title', 'body', 'audience', 'department_id',
        'requires_acknowledgement', 'pinned_at',
    ];

    protected function casts(): array
    {
        return ['requires_acknowledgement' => 'boolean', 'pinned_at' => 'datetime'];
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function acknowledgements(): HasMany
    {
        return $this->hasMany(AnnouncementAcknowledgement::class);
    }

    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }
}
