<?php

namespace App\Models\Helpdesk;

use App\Models\Attachment;
use App\Models\Organization;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class Ticket extends Model
{
    protected $table = 'helpdesk_tickets';

    public const STATUS_OPEN = 'open';

    public const STATUS_IN_PROGRESS = 'in_progress';

    public const STATUS_WAITING = 'waiting';

    public const STATUS_RESOLVED = 'resolved';

    public const STATUS_CLOSED = 'closed';

    public const STATUSES = ['open', 'in_progress', 'waiting', 'resolved', 'closed'];

    /** Statuses where someone still has to act (SLA clocks run). */
    public const ACTIVE = ['open', 'in_progress', 'waiting'];

    public const PRIORITIES = ['low', 'medium', 'high', 'urgent'];

    protected $fillable = [
        'organization_id', 'subject', 'description', 'status', 'priority', 'category', 'requester_id', 'assignee_id', 'created_by',
        'first_response_due_at', 'resolution_due_at', 'first_responded_at', 'resolved_at', 'closed_at', 'last_activity_at',
    ];

    protected $attributes = ['status' => 'open', 'priority' => 'medium'];

    protected function casts(): array
    {
        return [
            'first_response_due_at' => 'datetime', 'resolution_due_at' => 'datetime', 'first_responded_at' => 'datetime',
            'resolved_at' => 'datetime', 'closed_at' => 'datetime', 'last_activity_at' => 'datetime',
        ];
    }

    public function requester(): BelongsTo
    {
        return $this->belongsTo(User::class, 'requester_id');
    }

    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    /** Files added when the ticket was raised (reply files belong to the message). */
    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    public function messages(): HasMany
    {
        return $this->hasMany(TicketMessage::class)->orderBy('id');
    }

    public function isActive(): bool
    {
        return in_array($this->status, self::ACTIVE, true);
    }

    /** Human reference, e.g. HD-000042. */
    public function reference(): string
    {
        return 'HD-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT);
    }

    public function link(): string
    {
        return '/apps/helpdesk/tickets/'.$this->id;
    }
}
