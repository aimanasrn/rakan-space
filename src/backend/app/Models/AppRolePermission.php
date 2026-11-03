<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class AppRolePermission extends Model
{
    protected $fillable = ['organization_id', 'app_id', 'role', 'abilities'];

    protected function casts(): array
    {
        return ['abilities' => 'array'];
    }
}
