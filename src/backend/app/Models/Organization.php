<?php

namespace App\Models;

use App\Models\Approval\ApprovalDelegation;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Crm\Account as CrmAccount;
use App\Models\Crm\Activity as CrmActivity;
use App\Models\Crm\Contact as CrmContact;
use App\Models\Crm\Opportunity;
use App\Models\Crm\Stage as CrmStage;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Helpdesk\CannedResponse;
use App\Models\Helpdesk\Ticket;
use App\Models\Timesheet\Timesheet;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Organization extends Model
{
    use HasFactory;

    protected $fillable = ['name', 'slug', 'description', 'timezone', 'industry', 'website', 'created_by'];

    protected function casts(): array
    {
        return ['onboarding_completed_at' => 'datetime'];
    }

    public static function uniqueSlug(string $name): string
    {
        $base = Str::limit(Str::slug($name) ?: 'workspace', 60, '');
        $slug = $base;
        $i = 1;
        while (static::where('slug', $slug)->exists()) {
            $slug = $base.'-'.(++$i);
        }

        return $slug;
    }

    public function memberships(): HasMany
    {
        return $this->hasMany(OrganizationMembership::class);
    }

    public function activeMemberships(): HasMany
    {
        return $this->memberships()->where('status', OrganizationMembership::STATUS_ACTIVE);
    }

    public function members(): BelongsToMany
    {
        return $this->belongsToMany(User::class, 'organization_memberships')
            ->withPivot(['role', 'status'])
            ->wherePivot('status', OrganizationMembership::STATUS_ACTIVE);
    }

    public function departments(): HasMany
    {
        return $this->hasMany(Department::class);
    }

    public function invitations(): HasMany
    {
        return $this->hasMany(Invitation::class);
    }

    public function projects(): HasMany
    {
        return $this->hasMany(Project::class);
    }

    public function tasks(): HasMany
    {
        return $this->hasMany(Task::class);
    }

    public function conversations(): HasMany
    {
        return $this->hasMany(Conversation::class);
    }

    public function messages(): HasMany
    {
        return $this->hasMany(Message::class);
    }

    public function events(): HasMany
    {
        return $this->hasMany(Event::class);
    }

    public function announcements(): HasMany
    {
        return $this->hasMany(Announcement::class);
    }

    public function attachments(): HasMany
    {
        return $this->hasMany(Attachment::class);
    }

    public function activities(): HasMany
    {
        return $this->hasMany(Activity::class);
    }

    public function installedApps(): HasMany
    {
        return $this->hasMany(OrganizationApp::class);
    }

    /** Launcher banners (route parameter {banner}). */
    public function banners(): HasMany
    {
        return $this->hasMany(LauncherBanner::class);
    }

    /** App access requests (route parameter {accessRequest}). */
    public function accessRequests(): HasMany
    {
        return $this->hasMany(AppAccessRequest::class);
    }

    /** Route parameter {approvalWorkflow}. */
    public function approvalWorkflows(): HasMany
    {
        return $this->hasMany(ApprovalWorkflow::class);
    }

    /** Route parameter {approvalRequest}. */
    public function approvalRequests(): HasMany
    {
        return $this->hasMany(ApprovalRequest::class);
    }

    /** Route parameter {approvalDelegation}. */
    public function approvalDelegations(): HasMany
    {
        return $this->hasMany(ApprovalDelegation::class);
    }

    /** Route parameter {form}. */
    public function forms(): HasMany
    {
        return $this->hasMany(Form::class);
    }

    /** Route parameter {formSubmission}. */
    public function formSubmissions(): HasMany
    {
        return $this->hasMany(FormSubmission::class);
    }

    /** Helpdesk tickets. Route parameter {ticket} (scoped bindings need this name). */
    public function tickets(): HasMany
    {
        return $this->hasMany(Ticket::class);
    }

    /** Route parameter {cannedResponse}. */
    public function cannedResponses(): HasMany
    {
        return $this->hasMany(CannedResponse::class);
    }

    // Opportunity (CRM). Method names match route parameters for scoped bindings.

    public function accounts(): HasMany
    {
        return $this->hasMany(CrmAccount::class);
    }

    public function contacts(): HasMany
    {
        return $this->hasMany(CrmContact::class);
    }

    public function opportunities(): HasMany
    {
        return $this->hasMany(Opportunity::class);
    }

    public function stages(): HasMany
    {
        return $this->hasMany(CrmStage::class);
    }

    public function crmActivities(): HasMany
    {
        return $this->hasMany(CrmActivity::class);
    }

    /** Route parameter {timesheet}. */
    public function timesheets(): HasMany
    {
        return $this->hasMany(Timesheet::class);
    }

    public function logoUrl(): ?string
    {
        return $this->logo_path
            ? url('/api/orgs/'.$this->slug.'/logo?v='.substr(md5($this->logo_path), 0, 8))
            : null;
    }

    /** True when the user is an active member of this organisation. */
    public function hasActiveMember(int $userId): bool
    {
        return $this->activeMemberships()->where('user_id', $userId)->exists();
    }

    /**
     * Filters the given user IDs down to active members of this organisation.
     *
     * @param  array<int|string>  $userIds
     * @return list<int>
     */
    public function filterActiveMemberIds(array $userIds): array
    {
        $ids = array_values(array_unique(array_map('intval', $userIds)));
        if ($ids === []) {
            return [];
        }

        return $this->activeMemberships()->whereIn('user_id', $ids)->pluck('user_id')->map(fn ($id) => (int) $id)->all();
    }
}
