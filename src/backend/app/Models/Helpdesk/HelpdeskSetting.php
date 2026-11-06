<?php

namespace App\Models\Helpdesk;

use Illuminate\Database\Eloquent\Model;

class HelpdeskSetting extends Model
{
    protected $fillable = ['organization_id', 'sla', 'categories', 'auto_close_days'];

    /** Hours to first response / resolution, by priority. */
    public const DEFAULT_SLA = [
        'urgent' => ['first_response_hours' => 1, 'resolution_hours' => 8],
        'high' => ['first_response_hours' => 4, 'resolution_hours' => 24],
        'medium' => ['first_response_hours' => 8, 'resolution_hours' => 72],
        'low' => ['first_response_hours' => 24, 'resolution_hours' => 168],
    ];

    public const DEFAULT_CATEGORIES = ['IT', 'Facilities', 'HR', 'Finance', 'Other'];

    protected function casts(): array
    {
        return ['sla' => 'array', 'categories' => 'array', 'auto_close_days' => 'integer'];
    }

    /** @return array<string, array{first_response_hours: int, resolution_hours: int}> */
    public function slaPolicy(): array
    {
        return array_replace_recursive(self::DEFAULT_SLA, $this->sla ?? []);
    }

    /** @return list<string> */
    public function categoryList(): array
    {
        return $this->categories ?? self::DEFAULT_CATEGORIES;
    }
}
