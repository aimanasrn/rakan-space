<?php

namespace App\Models;

use App\Enums\Role;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationMembership extends Model
{
    public const STATUS_ACTIVE = 'active';

    public const STATUS_DEACTIVATED = 'deactivated';

    public const STATUS_REMOVED = 'removed';

    protected $fillable = ['organization_id', 'user_id', 'role', 'manager_id', 'status', 'joined_at', 'status_changed_at'];

    protected function casts(): array
    {
        return [
            'role' => Role::class,
            'joined_at' => 'datetime',
            'status_changed_at' => 'datetime',
        ];
    }

    public function organization(): BelongsTo
    {
        return $this->belongsTo(Organization::class);
    }

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }

    /** The user this member reports to (same organisation). */
    public function manager(): BelongsTo
    {
        return $this->belongsTo(User::class, 'manager_id');
    }

    public function isActive(): bool
    {
        return $this->status === self::STATUS_ACTIVE;
    }

    public function isAdministrator(): bool
    {
        return $this->role->isAdministrator();
    }
}
