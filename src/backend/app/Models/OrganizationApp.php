<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class OrganizationApp extends Model
{
    protected $fillable = ['organization_id', 'app_id', 'installed_by', 'installed_at'];

    protected function casts(): array
    {
        return ['installed_at' => 'datetime'];
    }

    public function app(): BelongsTo
    {
        return $this->belongsTo(LauncherApp::class);
    }
}
