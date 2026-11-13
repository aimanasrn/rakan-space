<?php

namespace App\Models\Leave;

use Illuminate\Database\Eloquent\Model;

class LeaveType extends Model
{
    protected $fillable = ['organization_id', 'key', 'name', 'color', 'entitlement_days', 'is_active', 'position'];

    protected function casts(): array
    {
        return ['entitlement_days' => 'float', 'is_active' => 'boolean', 'position' => 'integer'];
    }
}
