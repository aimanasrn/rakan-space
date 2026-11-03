# Architecture

RakanSpace is a modular monolith: a Laravel REST API that owns all business rules
and authorisation, and a Next.js app that handles presentation, routing and
client state.

```
Browser ──HTTPS──▶ Next.js (App Router, client-rendered workspace)
   │                    │
   │  cookies (Sanctum SPA session + XSRF)
   ├──────────────────▶ Laravel API  ──▶ PostgreSQL
   │                         │  └─────▶ Redis (sessions, cache, queues)
   │                         ├─ queue worker: notifications, broadcasts
   │                         ├─ scheduler: reminders, pruning
   │                         └─ private disk / S3: attachments
   └──WebSocket (Pusher protocol)──▶ Laravel Reverb
```

## Backend layout (`src/backend`)

| Area | Location |
|---|---|
| Routes (all under `/api`) | `routes/api.php`, `routes/channels.php`, `routes/console.php` |
| Organisation scoping | `app/Http/Middleware/ResolveOrganization.php` (+ `scopeBindings()`) |
| Access rules | `app/Support/Permissions.php` |
| Feature controllers | `app/Http/Controllers/*Controller.php` (one per module) |
| API shapes | `app/Http/Resources` |
| Domain helpers | `app/Support/ActivityLog.php`, `Notifier.php`, `Attachments.php` |
| Background work | `app/Jobs/DeliverNotifications.php`, `app/Console/Commands` |
| Real-time events | `app/Events/ConversationMessageChanged.php`, `UserEvent.php` |
| Schema | `database/migrations` (4 feature migrations) |
| Demo data | `database/seeders/DemoSeeder.php` |

### Organisation isolation

- Every organisation-owned table has `organization_id`.
- Workspace routes are `/api/orgs/{slug}/…`. The `org` middleware requires an
  *active* membership and returns 404 otherwise (existence is not revealed).
- Child models are resolved with Laravel scoped bindings
  (`$organization->projects()->findOrFail($id)`), so an ID from another
  organisation is a 404 even for an Owner of their own organisation.
- Composite foreign keys (`(project_id, organization_id) → projects(id, organization_id)`
  and the same for messages and departments) make cross-organisation
  references impossible at database level too.
- User IDs from the client (assignees, participants, members, mentions) are
  filtered against active memberships; uploads are only attachable by their
  uploader, within the same organisation, while still unattached.

### Messaging

- Channels and DMs share `conversations` + `conversation_members`
  (read position = `last_read_message_id`). DMs are unique per pair
  (`direct_key`).
- Sending is idempotent: the client generates `client_id` (UUID). A unique
  index on `(user_id, client_id)` means a retry returns the stored message
  (`200`, `duplicate: true`) instead of creating another.
- Messages are persisted first; `ConversationMessageChanged` implements
  `ShouldDispatchAfterCommit`, so nothing is broadcast for a rolled-back write.
- Broadcasts carry IDs only. The client fetches `GET …/messages?after={lastId}`,
  which is also the reconnection-recovery path (run on reconnect and when the
  tab becomes visible). Merging by `id` and `client_id` removes duplicates between
  the HTTP response and the broadcast.
- Deleted messages keep their row (`deleted_at`, body cleared) to show a clear
  "message deleted" state and keep threads intact.

### Notifications

`Notifier::send()` queues `DeliverNotifications` after commit. The job re-checks
active membership, inserts with `insertOrIgnore` (unique `(user_id, dedupe_key)`)
and only broadcasts rows that were actually inserted. Reminders use keys such as
`event-reminder:{id}:{starts_at}` and `task-due:{id}:{date}`, so repeated or
overlapping scheduler runs never duplicate them. Jobs retry 3 times with backoff;
failures are stored in `failed_jobs` and logged (without payloads).

### Time

- Event times are `timestamptz`, stored in UTC and returned as ISO-8601.
  The UI converts to/from the organisation time zone with `Intl`.
- Task deadlines are `date` columns and travel as `YYYY-MM-DD` strings; the UI
  formats them without any time-zone conversion so they never shift days.
- "Today", "overdue" and "due tomorrow" are evaluated in the organisation's time zone.

### Files

Uploads go to `POST /attachments` and stay private to the uploader until linked to
a message, task, project or announcement. The extension is checked against an
allow-list **and** the content-sniffed type; storage paths are generated
(`attachments/{org}/{yyyy}/{mm}/{uuid}.{ext}`). Downloads stream through an
authorised endpoint with `Content-Disposition: attachment`, `nosniff`, `no-store`
and a restrictive CSP. Inline preview is limited to images, PDF and plain text,
and sandboxed. Unattached uploads are pruned hourly.

### Search and reports

Search runs Postgres `ILIKE` queries that start from the same "visible" query
scopes used everywhere else, so results, snippets and totals only include what the
user can open. Reports require Manager+ and are limited to accessible projects.
Progress = done tasks ÷ all tasks (0 % with no tasks).

## Frontend layout (`src/frontend`)

| Area | Location |
|---|---|
| Auth & onboarding pages | `src/app/(auth)`, `src/app/onboarding`, `src/app/invitations/[token]` |
| Workspace shell | `src/app/w/[org]/layout.tsx` → `components/workspace/*` |
| Page views | `components/views/*-view.tsx` (each route's `page.tsx` wraps one in `<Suspense>`) |
| Feature components | `components/chat`, `components/tasks`, `components/projects` |
| API client | `lib/api.ts` (cookies, XSRF, error normalisation) |
| Real-time | `lib/echo.ts`, `lib/realtime.ts`, `components/workspace/realtime.tsx` |
| Dates/time zones | `lib/datetime.ts` |
| UI text | `lib/i18n.ts` (English dictionary, ready for a `ms` dictionary) |

The workspace is client-rendered (Next.js SPA pattern) with TanStack Query for
server state. Next.js 16 Cache Components is enabled; pages that read URL data are
wrapped in `<Suspense>` as required.
