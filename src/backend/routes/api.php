<?php

use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\AppAdminController;
use App\Http\Controllers\Approval\DelegationController as ApprovalDelegationController;
use App\Http\Controllers\Approval\RequestController as ApprovalRequestController;
use App\Http\Controllers\Approval\WorkflowController as ApprovalWorkflowController;
use App\Http\Controllers\AttachmentController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DepartmentController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\Form\FormController;
use App\Http\Controllers\Form\SubmissionController as FormSubmissionController;
use App\Http\Controllers\InvitationController;
use App\Http\Controllers\LauncherBannerController;
use App\Http\Controllers\LauncherController;
use App\Http\Controllers\MemberController;
use App\Http\Controllers\MessageController;
use App\Http\Controllers\NotificationController;
use App\Http\Controllers\OrganizationController;
use App\Http\Controllers\ProfileController;
use App\Http\Controllers\ProjectController;
use App\Http\Controllers\ReportController;
use App\Http\Controllers\SearchController;
use App\Http\Controllers\TaskCommentController;
use App\Http\Controllers\TaskController;
use App\Http\Controllers\Timesheet\ReportController as TimesheetReportController;
use App\Http\Controllers\Timesheet\SettingsController as TimesheetSettingsController;
use App\Http\Controllers\Timesheet\TimesheetController;
use Illuminate\Support\Facades\Route;

/*
|--------------------------------------------------------------------------
| RakanSpace REST API
|--------------------------------------------------------------------------
| Authentication: Sanctum stateful (cookie) SPA auth. Call
| GET /sanctum/csrf-cookie first, then send the X-XSRF-TOKEN header.
|
| Organisation routes live under /api/orgs/{slug}. The "org" middleware
| requires an *active* membership on every request and responds 404 to
| non-members. Child resources use scoped bindings, so guessed IDs from
| another organisation resolve to 404.
*/

Route::prefix('auth')->group(function () {
    Route::middleware('throttle:auth')->group(function () {
        Route::post('register', [AuthController::class, 'register']);
        Route::post('login', [AuthController::class, 'login']);
        Route::post('forgot-password', [AuthController::class, 'forgotPassword']);
        Route::post('reset-password', [AuthController::class, 'resetPassword']);
    });

    Route::middleware('auth:sanctum')->group(function () {
        Route::post('logout', [AuthController::class, 'logout']);
        Route::get('user', [AuthController::class, 'me']);
        Route::post('email/verification-notification', [AuthController::class, 'resendVerification'])->middleware('throttle:verification');
        Route::get('email/verify/{id}/{hash}', [AuthController::class, 'verify'])
            ->middleware(['signed', 'throttle:verification'])->name('verification.verify');
    });
});

// Public invitation preview (requires the secret token).
Route::get('invitations/{token}', [InvitationController::class, 'preview'])->middleware('throttle:auth');

Route::middleware('auth:sanctum')->group(function () {
    Route::put('profile', [ProfileController::class, 'update']);
    Route::put('profile/password', [ProfileController::class, 'updatePassword'])->middleware('throttle:auth');
    Route::post('profile/avatar', [ProfileController::class, 'uploadAvatar'])->middleware('throttle:uploads');
    Route::delete('profile/avatar', [ProfileController::class, 'deleteAvatar']);
    Route::get('users/{user}/avatar', [ProfileController::class, 'showAvatar']);

    Route::middleware('verified')->group(function () {
        Route::post('invitations/{token}/accept', [InvitationController::class, 'accept'])->middleware('throttle:invitations');
        Route::post('orgs', [OrganizationController::class, 'store'])->middleware('throttle:invitations');

        Route::prefix('orgs/{organization}')->middleware('org')->scopeBindings()->group(function () {
            Route::get('/', [OrganizationController::class, 'show']);
            Route::patch('/', [OrganizationController::class, 'update']);
            Route::get('logo', [OrganizationController::class, 'showLogo']);
            Route::post('logo', [OrganizationController::class, 'uploadLogo'])->middleware('throttle:uploads');
            Route::post('onboarding/complete', [OrganizationController::class, 'completeOnboarding']);
            Route::post('transfer-ownership', [OrganizationController::class, 'transferOwnership']);
            Route::get('audit-log', [OrganizationController::class, 'auditLog']);
            Route::get('dashboard', DashboardController::class);
            Route::get('search', SearchController::class);
            Route::get('reports', ReportController::class);

            // Members
            Route::get('members', [MemberController::class, 'index']);
            Route::patch('members/{membership}', [MemberController::class, 'update']);
            Route::put('members/{membership}/manager', [MemberController::class, 'updateManager']);
            Route::post('members/{membership}/deactivate', [MemberController::class, 'deactivate']);
            Route::post('members/{membership}/reactivate', [MemberController::class, 'reactivate']);
            Route::delete('members/{membership}', [MemberController::class, 'destroy']);

            // Departments
            Route::get('departments', [DepartmentController::class, 'index']);
            Route::post('departments', [DepartmentController::class, 'store']);
            Route::get('departments/{department}', [DepartmentController::class, 'show']);
            Route::put('departments/{department}', [DepartmentController::class, 'update']);
            Route::delete('departments/{department}', [DepartmentController::class, 'destroy']);
            Route::put('departments/{department}/members', [DepartmentController::class, 'syncMembers']);

            // Invitations
            Route::get('invitations', [InvitationController::class, 'index']);
            Route::post('invitations', [InvitationController::class, 'store'])->middleware('throttle:invitations');
            Route::post('invitations/{invitation}/resend', [InvitationController::class, 'resend'])->middleware('throttle:invitations');
            Route::delete('invitations/{invitation}', [InvitationController::class, 'revoke']);

            // Projects
            Route::get('projects', [ProjectController::class, 'index']);
            Route::post('projects', [ProjectController::class, 'store']);
            Route::get('projects/{project}', [ProjectController::class, 'show']);
            Route::patch('projects/{project}', [ProjectController::class, 'update']);
            Route::delete('projects/{project}', [ProjectController::class, 'destroy']);
            Route::post('projects/{project}/archive', [ProjectController::class, 'archive']);
            Route::post('projects/{project}/unarchive', [ProjectController::class, 'unarchive']);
            Route::put('projects/{project}/members', [ProjectController::class, 'syncMembers']);
            Route::get('projects/{project}/activity', [ProjectController::class, 'activity']);
            Route::post('projects/{project}/files', [AttachmentController::class, 'attachToProject']);
            Route::post('projects/{project}/tasks', [TaskController::class, 'store']);

            // Tasks
            Route::get('tasks', [TaskController::class, 'index']);
            Route::get('tasks/{task}', [TaskController::class, 'show']);
            Route::patch('tasks/{task}', [TaskController::class, 'update']);
            Route::delete('tasks/{task}', [TaskController::class, 'destroy']);
            Route::post('tasks/{task}/move', [TaskController::class, 'move']);
            Route::get('tasks/{task}/activity', [TaskController::class, 'activity']);
            Route::post('tasks/{task}/files', [TaskController::class, 'attachFiles']);
            Route::post('tasks/{task}/checklist', [TaskController::class, 'addChecklistItem']);
            Route::patch('tasks/{task}/checklist/{checklistItem}', [TaskController::class, 'updateChecklistItem']);
            Route::delete('tasks/{task}/checklist/{checklistItem}', [TaskController::class, 'deleteChecklistItem']);
            Route::get('tasks/{task}/comments', [TaskCommentController::class, 'index']);
            Route::post('tasks/{task}/comments', [TaskCommentController::class, 'store']);
            Route::delete('tasks/{task}/comments/{comment}', [TaskCommentController::class, 'destroy']);

            // Chat
            Route::get('conversations', [ConversationController::class, 'index']);
            Route::get('conversations/browse', [ConversationController::class, 'browse']);
            Route::post('channels', [ConversationController::class, 'storeChannel']);
            Route::post('direct-conversations', [ConversationController::class, 'direct']);
            Route::get('conversations/{conversation}', [ConversationController::class, 'show']);
            Route::patch('conversations/{conversation}', [ConversationController::class, 'update']);
            Route::post('conversations/{conversation}/join', [ConversationController::class, 'join']);
            Route::post('conversations/{conversation}/leave', [ConversationController::class, 'leave']);
            Route::post('conversations/{conversation}/members', [ConversationController::class, 'addMembers']);
            Route::delete('conversations/{conversation}/members/{userId}', [ConversationController::class, 'removeMember'])->whereNumber('userId');
            Route::post('conversations/{conversation}/read', [ConversationController::class, 'markRead']);
            Route::get('conversations/{conversation}/messages', [MessageController::class, 'index']);
            Route::post('conversations/{conversation}/messages', [MessageController::class, 'store'])->middleware('throttle:messages');
            Route::get('conversations/{conversation}/messages/{message}', [MessageController::class, 'show']);
            Route::patch('conversations/{conversation}/messages/{message}', [MessageController::class, 'update'])->middleware('throttle:messages');
            Route::delete('conversations/{conversation}/messages/{message}', [MessageController::class, 'destroy']);

            // Files
            Route::get('files', [AttachmentController::class, 'index']);
            Route::post('attachments', [AttachmentController::class, 'store'])->middleware('throttle:uploads');
            Route::get('attachments/{attachment}', [AttachmentController::class, 'show']);
            Route::get('attachments/{attachment}/download', [AttachmentController::class, 'download']);
            Route::delete('attachments/{attachment}', [AttachmentController::class, 'destroy']);

            // Notifications
            Route::get('notifications', [NotificationController::class, 'index']);
            Route::get('notifications/unread-count', [NotificationController::class, 'unreadCount']);
            Route::post('notifications/read-all', [NotificationController::class, 'markAllRead']);
            Route::post('notifications/{notification}/read', [NotificationController::class, 'markRead'])->whereUuid('notification');

            // Calendar
            Route::get('events', [EventController::class, 'index']);
            Route::post('events', [EventController::class, 'store']);
            Route::get('events/{event}', [EventController::class, 'show']);
            Route::put('events/{event}', [EventController::class, 'update']);
            Route::delete('events/{event}', [EventController::class, 'destroy']);

            // App launcher (members)
            Route::get('launcher', [LauncherController::class, 'index']);
            Route::get('apps/{appKey}', [LauncherController::class, 'show']);
            Route::patch('user-apps/{appKey}/pin', [LauncherController::class, 'pin']);
            Route::post('user-apps/{appKey}/install', [LauncherController::class, 'install']);
            Route::post('user-apps/{appKey}/request-access', [LauncherController::class, 'requestAccess'])->middleware('throttle:invitations');
            Route::get('launcher/banners/{banner}/image', [LauncherBannerController::class, 'image']);

            // App launcher (Owner/Admin)
            Route::get('admin/apps', [AppAdminController::class, 'index']);
            Route::post('admin/apps/{appKey}/install', [AppAdminController::class, 'install']);
            Route::delete('admin/apps/{appKey}', [AppAdminController::class, 'uninstall']);
            Route::put('admin/apps/{appKey}/permissions', [AppAdminController::class, 'updatePermissions']);
            Route::get('admin/app-requests', [AppAdminController::class, 'requests']);
            Route::post('admin/app-requests/{accessRequest}/approve', [AppAdminController::class, 'approve']);
            Route::post('admin/app-requests/{accessRequest}/reject', [AppAdminController::class, 'reject']);
            Route::get('launcher/banners', [LauncherBannerController::class, 'index']);
            Route::post('launcher/banners', [LauncherBannerController::class, 'store']);
            Route::patch('launcher/banners/{banner}', [LauncherBannerController::class, 'update']);
            Route::delete('launcher/banners/{banner}', [LauncherBannerController::class, 'destroy']);
            Route::post('launcher/banners/{banner}/image', [LauncherBannerController::class, 'uploadImage'])->middleware('throttle:uploads');
            Route::delete('launcher/banners/{banner}/image', [LauncherBannerController::class, 'deleteImage']);

            // Approval (participants need no app ability; designers need Approval "admin")
            Route::prefix('approval')->group(function () {
                Route::get('summary', [ApprovalRequestController::class, 'summary']);
                Route::get('requests', [ApprovalRequestController::class, 'index']);
                Route::post('requests', [ApprovalRequestController::class, 'store']);
                Route::get('requests/{approvalRequest}', [ApprovalRequestController::class, 'show']);
                Route::post('requests/{approvalRequest}/decide', [ApprovalRequestController::class, 'decide']);
                Route::post('requests/{approvalRequest}/resubmit', [ApprovalRequestController::class, 'resubmit']);
                Route::post('requests/{approvalRequest}/cancel', [ApprovalRequestController::class, 'cancel']);
                Route::get('workflows', [ApprovalWorkflowController::class, 'index']);
                Route::post('workflows', [ApprovalWorkflowController::class, 'store']);
                Route::get('workflows/{approvalWorkflow}', [ApprovalWorkflowController::class, 'show']);
                Route::put('workflows/{approvalWorkflow}', [ApprovalWorkflowController::class, 'update']);
                Route::delete('workflows/{approvalWorkflow}', [ApprovalWorkflowController::class, 'destroy']);
                Route::get('delegations', [ApprovalDelegationController::class, 'index']);
                Route::post('delegations', [ApprovalDelegationController::class, 'store']);
                Route::delete('delegations/{approvalDelegation}', [ApprovalDelegationController::class, 'destroy']);
            });

            // Form
            Route::middleware('app:form')->group(function () {
                Route::get('forms', [FormController::class, 'index']);
                Route::post('forms', [FormController::class, 'store']);
                Route::get('forms/{form}', [FormController::class, 'show']);
                Route::patch('forms/{form}', [FormController::class, 'update']);
                Route::delete('forms/{form}', [FormController::class, 'destroy']);
                Route::put('forms/{form}/draft', [FormController::class, 'saveDraft']);
                Route::delete('forms/{form}/draft', [FormController::class, 'discardDraft']);
                Route::post('forms/{form}/publish', [FormController::class, 'publish']);
                Route::post('forms/{form}/unpublish', [FormController::class, 'unpublish']);
                Route::get('forms/{form}/versions', [FormController::class, 'versions']);
                Route::get('forms/{form}/submissions', [FormSubmissionController::class, 'forForm']);
                Route::post('forms/{form}/submissions', [FormSubmissionController::class, 'store'])->middleware('throttle:messages');
                Route::get('form-submissions', [FormSubmissionController::class, 'index']);
                Route::get('form-submissions/{formSubmission}', [FormSubmissionController::class, 'show']);
                Route::put('form-submissions/{formSubmission}', [FormSubmissionController::class, 'update']);
                Route::post('form-submissions/{formSubmission}/withdraw', [FormSubmissionController::class, 'withdraw']);
            });

            // Timesheet ({week} is any date in the week; weeks start on Monday)
            Route::prefix('timesheet')->middleware('app:timesheet')->group(function () {
                Route::get('weeks/{week}', [TimesheetController::class, 'week'])->where('week', '\d{4}-\d{2}-\d{2}');
                Route::put('weeks/{week}', [TimesheetController::class, 'saveWeek'])->where('week', '\d{4}-\d{2}-\d{2}');
                Route::post('weeks/{week}/submit', [TimesheetController::class, 'submitWeek'])->where('week', '\d{4}-\d{2}-\d{2}');
                Route::get('sheets', [TimesheetController::class, 'index']);
                Route::get('sheets/{timesheet}', [TimesheetController::class, 'show']);
                Route::post('sheets/{timesheet}/withdraw', [TimesheetController::class, 'withdraw']);
                Route::get('projects', [TimesheetController::class, 'projects']);
                Route::get('projects/{project}/tasks', [TimesheetController::class, 'tasks']);
                Route::get('report', TimesheetReportController::class);
                Route::get('settings', [TimesheetSettingsController::class, 'show']);
                Route::put('settings', [TimesheetSettingsController::class, 'update']);
            });

            // Announcements
            Route::get('announcements', [AnnouncementController::class, 'index']);
            Route::post('announcements', [AnnouncementController::class, 'store']);
            Route::get('announcements/{announcement}', [AnnouncementController::class, 'show']);
            Route::patch('announcements/{announcement}', [AnnouncementController::class, 'update']);
            Route::delete('announcements/{announcement}', [AnnouncementController::class, 'destroy']);
            Route::post('announcements/{announcement}/acknowledge', [AnnouncementController::class, 'acknowledge']);
            Route::get('announcements/{announcement}/acknowledgements', [AnnouncementController::class, 'acknowledgements']);
        });
    });
});
