<?php

namespace App\Models\Crm;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Account extends Model
{
    protected $table = 'crm_accounts';

    protected $fillable = ['organization_id', 'name', 'industry', 'website', 'phone', 'address', 'notes', 'owner_id', 'created_by'];

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(Contact::class)->orderBy('name');
    }

    public function opportunities(): HasMany
    {
        return $this->hasMany(Opportunity::class);
    }
}
