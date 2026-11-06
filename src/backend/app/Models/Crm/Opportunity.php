<?php

namespace App\Models\Crm;

use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Opportunity extends Model
{
    protected $table = 'crm_opportunities';

    protected $fillable = [
        'organization_id', 'name', 'account_id', 'contact_id', 'stage_id', 'owner_id', 'amount',
        'expected_close_date', 'description', 'lost_reason', 'closed_at', 'position', 'created_by',
    ];

    protected function casts(): array
    {
        return ['amount' => 'decimal:2', 'expected_close_date' => 'date', 'closed_at' => 'datetime', 'position' => 'integer'];
    }

    public function stage(): BelongsTo
    {
        return $this->belongsTo(Stage::class);
    }

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }

    public function contact(): BelongsTo
    {
        return $this->belongsTo(Contact::class);
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class)->latest('id');
    }

    public function link(): string
    {
        return '/apps/opportunity/deals/'.$this->id;
    }
}
