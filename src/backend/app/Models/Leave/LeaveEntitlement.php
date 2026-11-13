<?php

namespace App\Models\Leave;

use Illuminate\Database\Eloquent\Model;

/** A member's entitlement for one leave type and year, set by an admin (overrides the type's default). */
class LeaveEntitlement extends Model
{
    protected $fillable = ['organization_id', 'user_id', 'leave_type_id', 'year', 'days'];

    protected function casts(): array
    {
        return ['days' => 'float', 'year' => 'integer'];
    }
}
