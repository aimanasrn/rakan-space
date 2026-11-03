<?php

use App\Http\Controllers\AnnouncementController;
use App\Http\Controllers\AttachmentController;
use App\Http\Controllers\Auth\AuthController;
use App\Http\Controllers\ConversationController;
use App\Http\Controllers\DashboardController;
use App\Http\Controllers\DepartmentController;
use App\Http\Controllers\EventController;
use App\Http\Controllers\InvitationController;
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
