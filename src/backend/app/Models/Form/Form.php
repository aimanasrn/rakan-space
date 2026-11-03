<?php

namespace App\Models\Form;

use App\Models\Approval\ApprovalWorkflow;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Form extends Model
{
    public const STATUS_DRAFT = 'draft';

    public const STATUS_PUBLISHED = 'published';

    public const STATUS_CLOSED = 'closed';

    protected $fillable = [
        'organization_id', 'name', 'description', 'status', 'current_version_id', 'audience',
        'workflow_id', 'allow_multiple', 'created_by', 'published_at',
    ];

    protected $attributes = ['status' => self::STATUS_DRAFT, 'allow_multiple' => true];

    protected function casts(): array
    {
        return ['audience' => 'array', 'allow_multiple' => 'boolean', 'published_at' => 'datetime'];
    }

    public function versions(): HasMany
    {
        return $this->hasMany(FormVersion::class)->orderByDesc('version');
    }

    public function currentVersion(): BelongsTo
    {
        return $this->belongsTo(FormVersion::class, 'current_version_id');
    }

    public function draftVersion(): HasOne
    {
        return $this->hasOne(FormVersion::class)->whereNull('published_at');
    }

    public function submissions(): HasMany
    {
        return $this->hasMany(FormSubmission::class);
    }

    public function workflow(): BelongsTo
    {
        return $this->belongsTo(ApprovalWorkflow::class, 'workflow_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    /** Published and accepting submissions. */
    public function isOpen(): bool
    {
        return $this->status === self::STATUS_PUBLISHED && $this->current_version_id !== null;
    }
}
