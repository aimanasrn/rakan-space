<?php

namespace App\Models;

use App\Support\AppCatalog;
use Illuminate\Database\Eloquent\Model;

/** A launcher app from the global catalogue (see App\Support\AppCatalog). */
class LauncherApp extends Model
{
    protected $table = 'apps';

    protected $fillable = [
        'key', 'name', 'tagline', 'description', 'icon', 'gradient_from', 'gradient_to', 'category', 'is_default', 'sort_order',
    ];

    protected function casts(): array
    {
        return ['is_default' => 'boolean', 'sort_order' => 'integer'];
    }

    public static function findByKeyOrFail(string $key): self
    {
        return static::where('key', $key)->firstOrFail();
    }

    /** Workspace-relative path of the app's home page. */
    public function path(): string
    {
        return AppCatalog::path($this->key);
    }
}
