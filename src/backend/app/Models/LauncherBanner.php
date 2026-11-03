<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class LauncherBanner extends Model
{
    protected $fillable = [
        'organization_id', 'title', 'description', 'cta_label', 'cta_url', 'illustration',
        'is_active', 'sort_order', 'starts_at', 'ends_at', 'created_by',
    ];

    /** Same defaults as the table, so new models report the right state. */
    protected $attributes = ['is_active' => true, 'sort_order' => 0];

    protected function casts(): array
    {
        return [
            'is_active' => 'boolean',
            'sort_order' => 'integer',
            'starts_at' => 'datetime',
            'ends_at' => 'datetime',
        ];
    }

    /** Active and inside its optional start/end window. */
    public function isLive(): bool
    {
        return $this->is_active
            && ($this->starts_at === null || $this->starts_at->lte(now()))
            && ($this->ends_at === null || $this->ends_at->gt(now()));
    }

    public function imageUrl(string $orgSlug): ?string
    {
        return $this->image_path
            ? url('/api/orgs/'.$orgSlug.'/launcher/banners/'.$this->id.'/image?v='.substr(md5($this->image_path), 0, 8))
            : null;
    }
}
