<?php

namespace App\Providers;

use App\Events\ApprovalRequestStatusChanged;
use App\Models\Announcement;
use App\Models\AppAccessRequest;
use App\Models\Approval\ApprovalRequest;
use App\Models\Approval\ApprovalWorkflow;
use App\Models\Conversation;
use App\Models\Department;
use App\Models\Event;
use App\Models\Form\Form;
use App\Models\Form\FormSubmission;
use App\Models\Invitation;
use App\Models\LauncherApp;
use App\Models\LauncherBanner;
use App\Models\Message;
use App\Models\Organization;
use App\Models\OrganizationMembership;
use App\Models\Project;
use App\Models\Task;
use App\Models\TaskComment;
use App\Models\User;
use App\Support\Forms\SyncSubmissionWithApproval;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\Relation;
use Illuminate\Http\Request;
use Illuminate\Queue\Events\JobFailed;
use Illuminate\Support\Facades\Event as EventFacade;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\Facades\Route;
use Illuminate\Support\ServiceProvider;
use Illuminate\Validation\Rules\Password;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        Model::preventSilentlyDiscardingAttributes(! $this->app->isProduction());

        // Stable names in polymorphic columns instead of PHP class names.
        Relation::enforceMorphMap([
            'user' => User::class,
            'organization' => Organization::class,
            'membership' => OrganizationMembership::class,
            'department' => Department::class,
            'invitation' => Invitation::class,
            'project' => Project::class,
            'task' => Task::class,
            'task_comment' => TaskComment::class,
            'conversation' => Conversation::class,
            'message' => Message::class,
            'event' => Event::class,
            'announcement' => Announcement::class,
            'app' => LauncherApp::class,
            'launcher_banner' => LauncherBanner::class,
            'app_access_request' => AppAccessRequest::class,
            'approval_workflow' => ApprovalWorkflow::class,
            'approval_request' => ApprovalRequest::class,
            'form' => Form::class,
            'form_submission' => FormSubmission::class,
        ]);

        // Modules react to approval outcomes (synchronously, inside the same transaction).
        EventFacade::listen(ApprovalRequestStatusChanged::class, [SyncSubmissionWithApproval::class, 'handle']);

        // Workspaces are addressed by slug in URLs.
        Route::bind('organization', fn (string $value) => Organization::where('slug', $value)->firstOrFail());

        Password::defaults(fn () => $this->app->isProduction()
            ? Password::min(10)->letters()->numbers()->uncompromised()
            : Password::min(8));

        $this->configureRateLimiting();

        // Failed jobs are stored in failed_jobs; also log them (without payloads).
        EventFacade::listen(JobFailed::class, function (JobFailed $event) {
            Log::error('Queued job failed', [
                'job' => $event->job->resolveName(),
                'queue' => $event->job->getQueue(),
                'attempts' => $event->job->attempts(),
                'error' => $event->exception->getMessage(),
            ]);
        });
    }

    protected function configureRateLimiting(): void
    {
        RateLimiter::for('api', fn (Request $request) => Limit::perMinute(240)->by($request->user()?->id ?: $request->ip()));

        RateLimiter::for('auth', fn (Request $request) => [
            Limit::perMinute(10)->by('auth-ip:'.$request->ip()),
            Limit::perMinute(5)->by('auth-email:'.strtolower((string) $request->input('email')).'|'.$request->ip()),
        ]);

        RateLimiter::for('verification', fn (Request $request) => Limit::perMinute(3)->by('verify:'.($request->user()?->id ?: $request->ip())));

        RateLimiter::for('invitations', fn (Request $request) => Limit::perHour(50)->by('invite:'.($request->user()?->id ?: $request->ip())));

        RateLimiter::for('messages', fn (Request $request) => Limit::perMinute(60)->by('msg:'.($request->user()?->id ?: $request->ip())));

        RateLimiter::for('uploads', fn (Request $request) => Limit::perMinute(30)->by('upload:'.($request->user()?->id ?: $request->ip())));
    }
}
