<?php

namespace App\Models\Crm;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Contact extends Model
{
    protected $table = 'crm_contacts';

    protected $fillable = ['organization_id', 'account_id', 'name', 'email', 'phone', 'job_title', 'created_by'];

    public function account(): BelongsTo
    {
        return $this->belongsTo(Account::class);
    }
}
