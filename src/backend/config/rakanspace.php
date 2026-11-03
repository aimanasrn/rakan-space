<?php

return [

    /*
    | Base URL of the Next.js frontend. Email links (verification, password
    | reset, invitations) point here.
    */
    'frontend_url' => rtrim(env('FRONTEND_URL', 'http://localhost:3000'), '/'),

    'invitations' => [
        'expires_in_days' => (int) env('INVITATION_EXPIRES_DAYS', 7),
    ],

    'attachments' => [
        'disk' => env('ATTACHMENTS_DISK', 'local'),
        // Kilobytes.
        'max_size' => (int) env('ATTACHMENTS_MAX_KB', 20480),
        // Allowed extensions. Executables and scripts are never accepted.
        'allowed_extensions' => [
            'jpg', 'jpeg', 'png', 'gif', 'webp',
            'pdf', 'txt', 'csv', 'md',
            'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp',
            'zip',
        ],
        // Types that can be shown inline in the browser. Everything else downloads.
        'inline_mime_types' => [
            'image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'text/plain',
        ],
        // Unattached uploads older than this are pruned by the scheduler.
        'pending_ttl_hours' => 24,
    ],

    'avatars' => [
        'max_size' => 2048,
    ],

    'reminders' => [
        // Default minutes before an event to remind participants.
        'event_minutes' => 15,
    ],
];
