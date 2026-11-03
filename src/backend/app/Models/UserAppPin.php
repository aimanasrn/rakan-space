<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class UserAppPin extends Model
{
    public const UPDATED_AT = null;

    protected $fillable = ['organization_id', 'user_id', 'app_id'];
}
