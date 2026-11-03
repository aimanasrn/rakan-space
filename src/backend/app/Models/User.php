<?php

namespace App\Models;

use App\Notifications\ResetPasswordNotification;
use App\Notifications\VerifyEmailNotification;
use Database\Factories\UserFactory;
use Illuminate\Contracts\Auth\MustVerifyEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;

class User extends Authenticatable implements MustVerifyEmail
{
    /** @use HasFactory<UserFactory> */
    use HasFactory, Notifiable;

    protected $fillable = ['name', 'email', 'password', 'job_title', 'phone'];

    protected $hidden = ['password', 'remember_token'];

    /** @var array<int, OrganizationMembership|null> Per-request cache of active memberships. */
    protected array $membershipCache = [];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
        ];
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(OrganizationMembership::class);
    }

    public function organizations(): BelongsToMany
    {
        return $this->belongsToMany(Organization::class, 'organization_memberships')
            ->withPivot(['role', 'status'])
            ->wherePivot('status', OrganizationMembership::STATUS_ACTIVE);
    }

    /**
     * The user's *active* membership in an organisation, or null.
     * Cached for the lifetime of this model instance (one request).
     */
    public function membershipIn(Organization|int $organization): ?OrganizationMembership
    {
        $id = $organization instanceof Organization ? $organization->id : $organization;

        if (! array_key_exists($id, $this->membershipCache)) {
            $this->membershipCache[$id] = OrganizationMembership::query()
                ->where('organization_id', $id)
                ->where('user_id', $this->id)
                ->where('status', OrganizationMembership::STATUS_ACTIVE)
                ->first();
        }

        return $this->membershipCache[$id];
    }

    public function forgetMembershipCache(): void
    {
        $this->membershipCache = [];
    }

    public function avatarUrl(): ?string
    {
        return $this->avatar_path
            ? url('/api/users/'.$this->id.'/avatar?v='.substr(md5($this->avatar_path), 0, 8))
            : null;
    }

    public function sendEmailVerificationNotification(): void
    {
        $this->notify(new VerifyEmailNotification);
    }

    public function sendPasswordResetNotification($token): void
    {
        $this->notify(new ResetPasswordNotification($token));
    }
}
