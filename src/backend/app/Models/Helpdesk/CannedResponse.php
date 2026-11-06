<?php

namespace App\Models\Helpdesk;

use Illuminate\Database\Eloquent\Model;

class CannedResponse extends Model
{
    protected $table = 'helpdesk_canned_responses';

    protected $fillable = ['organization_id', 'title', 'body', 'created_by'];
}
