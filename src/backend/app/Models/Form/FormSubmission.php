<?php

namespace App\Models\Form;

use App\Models\Approval\ApprovalRequest;
use App\Models\Attachment;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\MorphMany;

class FormSubmission extends Model
{
    public const STATUS_SUBMITTED = 'submitted';

    public const STATUS_PENDING_APPROVAL = 'pending_approval';

    public const STATUS_APPROVED = 'approved';

    public const STATUS_REJECTED = 'rejected';

    public const STATUS_RETURNED = 'returned';

    public const STATUS_WITHDRAWN = 'withdrawn';

    public const STATUSES = ['submitted', 'pending_approval', 'approved', 'rejected', 'returned', 'withdrawn'];

    protected $fillable = ['organization_id', 'form_id', 'form_version_id', 'submitter_id', 'status', 'approval_request_id', 'submitted_at'];

    protected function casts(): array
    {
        return ['submitted_at' => 'datetime'];
    }

    public function form(): BelongsTo
    {
        return $this->belongsTo(Form::class);
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(FormVersion::class, 'form_version_id');
    }

    public function submitter(): BelongsTo
    {
        return $this->belongsTo(User::class, 'submitter_id');
    }

    public function values(): HasMany
    {
        return $this->hasMany(FormSubmissionValue::class);
    }

    public function approvalRequest(): BelongsTo
    {
        return $this->belongsTo(ApprovalRequest::class);
    }

    public function attachments(): MorphMany
    {
        return $this->morphMany(Attachment::class, 'attachable');
    }

    /** Human reference, e.g. FRM-000012. */
    public function reference(): string
    {
        return 'FRM-'.str_pad((string) $this->id, 6, '0', STR_PAD_LEFT);
    }
}
