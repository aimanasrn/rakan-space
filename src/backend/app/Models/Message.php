<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphMany;

/**
 * Deleted messages keep their row (deleted_at set, body cleared) so threads and
 * history show a clear "message deleted" state.
 */
class Message extends Model
{
    protected $fillable = [
        'organization_id', 'conversation_id', 'user_id', 'client_id', 'parent_id',
        'body', 'mentions', 'edited_at', 'deleted_at',
    ];

    protected function casts(): array
    {
        return [
            'mentions' => 'array',
            'edited_at' => 'datetime',
            'deleted_at' => 'datetime',
        ];
    }

    public function conversation(): BelongsTo
    {
        return $this->belongsTo(Conversation::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    public function parent(): BelongsTo
    {
        return $this->belongsTo(self::class, 'parent_id');
    }

    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    public function isDeleted(): bool
    {
        return $this->deleted_at !== null;
    }
}
