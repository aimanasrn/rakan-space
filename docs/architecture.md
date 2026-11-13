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
| Domain helpers | `app/Support/ActivityLog.php`, `Notifier.php`, `Attachments.php`, `AppCatalog.php`, `AppInstaller.php`, `ReportingLine.php` |
| Background work | `app/Jobs/DeliverNotifications.php`, `app/Console/Commands` |
| Real-time events | `app/Events/ConversationMessageChanged.php`, `UserEvent.php` |
| Schema | `database/migrations` (feature migrations, one or more per module) |
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

Pass `email: true` to also queue a `NotificationMail` (title, short body, link)
to each recipient whose in-app row was newly inserted, so deduplication applies
to email too. Used for app access requests and their decisions.

### App launcher and modules

- The app catalogue is defined in `App\Support\AppCatalog` and synced into the
  `apps` table by the migration, `AppCatalogSeeder` and
  `php artisan rakanspace:sync-apps` (also run by the Docker entrypoint).
- `organization_apps` = what each organisation installed (new organisations get
  the default apps); `user_app_pins` = per-user shortcuts;
  `app_role_permissions` = per-organisation overrides of role abilities;
  `app_access_requests` = members asking for marketplace apps;
  `launcher_banners` = admin-managed carousel slides.
- `GET /api/orgs/{slug}/launcher` returns `{ banners, installed, marketplace,
  can_manage }`, filtered on the server. Each app's home page lives at
  `/w/{slug}/apps/{key}` (Project points to the existing `/projects`).
- `organization_memberships.manager_id` is the reporting line, constrained to
  the same organisation. `App\Support\ReportingLine::managerOf()` returns the
  active manager (for approval routing).
- Module code lives in its own folders: `app/Models/{Approval,Form}`,
  `app/Http/Controllers/{Approval,Form}`, `app/Support/{Approvals,Forms}`,
  `src/components/apps/{approval,form}` and `src/app/w/[org]/apps/{approval,form}`.
  Module routes can require their app with the `app:{key}` middleware (404 otherwise).

### Approval engine (`App\Support\Approvals\Approvals`)

Any module sends something for approval with:

```php
Approvals::submitForApproval($organization, $user, 'form_submission', $id, $workflow, $title, $data, $summary, $link);
```

- **Workflows** (`approval_workflows` + `approval_workflow_steps`) are templates.
  On submit, the steps are copied into `approval_request_steps` for the current
  *round*, so editing a workflow never changes requests in progress.
- **Steps** run in order. Each step's approvers are a list of
  `{type: user|role|manager}` resolved **when the step starts** (current
  reporting lines and delegations). Mode `any` = one approval completes the step;
  `all` = everyone must approve (parallel). A step with a `condition`
  (`{field, operator, value}`, e.g. `amount gt 5000`) is skipped when it does not
  match the request `data`. The requester is removed; an empty step goes to
  Owners/Admins.
- **Decisions**: approve / reject / return (reject and return need a comment).
  Return lets the requester change and resubmit; that starts round 2 from the first step.
- **SLA**: `rakanspace:approval-sla` (every 5 minutes) reminds waiting approvers
  when a step passes `sla_hours` and adds the `escalate_to` user at twice the time.
  Each is claimed with a conditional update, so overlapping runs never repeat it.
- **Audit trail**: every event is an `approval_actions` row (submitted, step
  started, decisions with comments, skipped, reminded, escalated, delegated, …).
- **Events**: `ApprovalRequestStatusChanged` (IDs only) is dispatched synchronously
  inside the transaction whenever a request is approved, rejected, returned,
  cancelled or resubmitted. Modules listen to it (the Form module's
  `SyncSubmissionWithApproval` updates the response status). Notifications go
  through `Notifier` with dedupe keys and email copies.

### Form module (`App\Support\Forms`)

- A form has at most one **draft** version (`form_versions.published_at` is null)
  that the builder replaces as a whole (`PUT /forms/{id}/draft`). Publishing
  freezes it and makes it `current_version_id`; each response points at the
  version it was filled against, so old answers always show with their own fields.
- **Field types**: text, textarea, number, date, dropdown, radio, checkbox,
  file, signature, table (repeater with text/number/date/dropdown columns).
- **Show/hide rules**: one condition per field, which may only use a field above
  it (no loops). The server (`SubmissionValidator`) and the client
  (`src/lib/conditions.ts`) evaluate the same rules; hidden fields are never
  required and their values are dropped. Rules are shared with approval step
  conditions (`App\Support\Conditions`).
- **Files and signatures** reuse private attachments: upload first, then the
  response links them (only the submitter's own unattached uploads).
  Signatures are PNG uploads (drawn or typed).
- If the form has a workflow, each response is submitted with its non-file
  answers as approval `data`, so step conditions can use field keys.

### Opportunity module (`App\Support\Crm\Pipeline`)

- Tables are prefixed `crm_`: stages, accounts, contacts, opportunities, activities.
  Every reference uses a composite `(id, organization_id)` foreign key.
- Stages are per organisation (default pipeline created on first use): open stages
  with a win probability, exactly one **won** and one **lost** stage. Moving into
  won/lost sets `closed_at`; lost needs a `lost_reason`. Stages with deals cannot
  be removed or change type.
- The board loads every visible deal (won/lost from the last 90 days by default);
  drag-and-drop and a "Move to" menu call `POST /crm/opportunities/{id}/move`.
- Forecast: open deals by month of expected close, with value × stage probability
  ("weighted"), plus won value by month closed, from the visible deals only.
- Follow-up tasks are activities of type `task` with a due date; "My follow-ups"
  lists the member's open ones. There are no reminders for them yet.

### Helpdesk module (`App\Support\Helpdesk`)

- `helpdesk_tickets` hold the request (subject, description, priority, category,
  requester, assignee) and its SLA due times; `helpdesk_messages` hold replies and
  internal notes (`is_internal`). Files attach to the ticket (raised with it) or to
  a message, and follow `canViewTicket` / `canViewTicketMessage`.
- Status: `open` → `in_progress` / `waiting` (on requester) → `resolved` → `closed`.
  An agent's public reply to an open ticket moves it to in progress; the requester's
  reply to a waiting or resolved ticket sends it back to the agents.
- SLA targets per priority (hours to first response and to resolution) come from
  `helpdesk_settings`; due times are fixed when the ticket is raised and recalculated
  from its creation time when the priority changes. Calendar hours; the clock does
  not pause while waiting on the requester.
- `rakanspace:helpdesk-sla` (every 5 minutes) warns the assignee (or the agents)
  an hour before a target and when it is missed, once per due time, and closes
  resolved tickets after `auto_close_days`.
- Agent identity: `Permissions::isHelpdeskAgent()` (listed in `helpdesk_agents` or
  role with "edit"). New-ticket alerts go to listed agents, or to every agent when
  none is listed (`Helpdesk::queueRecipientIds()`).
- No live push yet: the ticket page polls every 30 seconds.

### Timesheet module (`App\Support\Timesheets`)

- One `timesheets` row per member per week (`week_start` is the Monday, in the
  organisation's time zone). `PUT /timesheet/weeks/{date}` replaces the week's
  entries as a whole; each entry is one project/task (or General) on one day,
  at most 24 h per day. Future weeks cannot be logged.
- Entries keep a copy of the project and task names, and their foreign keys are
  set to null when a project or task is deleted, so history survives.
- Status: `draft` → `pending_approval` → `approved` / `rejected` / `returned`.
  Submitting calls `Approvals::submitForApproval()` with `hours` and `week_start`
  as `data` (step conditions can use `hours`, e.g. more than 45).
  `SyncTimesheetWithApproval` mirrors the request status; withdrawing cancels
  the request and the week becomes a draft. Editing a rejected week starts a
  new draft; a returned week is resubmitted on the same request (next round).
- `rakanspace:timesheet-reminders` (daily, 09:00) reminds members once about
  past weeks with logged time that were never submitted.

### Leave module (`App\Support\Leave\Leaves`)

- `leave_types` per organisation, created from `Leaves::DEFAULT_TYPES` the first
  time the app is used (Annual 14, Medical 14, Govt Paid Paternity 7, Business
  Travel no limit, Calamity 3, Claim Off-in-Lieu 0, Compassionate 3, Marriage 3,
  Training no limit, Unpaid no limit, Hospitalization 60). `entitlement_days`
  null = no limit. `leave_entitlements` overrides one member's days for a year.
- Balances are per calendar year (by start date): **eligible** (override or
  type default), **taken** (approved), **pending** (pending/returned) and
  **balance** = eligible − taken. An application cannot span two years.
- Status: `pending_approval` → `approved` / `rejected` / `returned`, or
  `cancelled`. Applying calls `Approvals::submitForApproval()` with `days`,
  `leave_type` and `start_date` as `data`; `SyncLeaveWithApproval` mirrors the
  request status. A returned application is changed and resubmitted on the same
  request. Applications are serialised per member (row lock on the membership)
  so balance and overlap checks cannot race.
- Public holidays are not excluded yet; only weekends are.

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
| Feature components | `components/chat`, `components/tasks`, `components/projects`, `components/launcher` |
| API client | `lib/api.ts` (cookies, XSRF, error normalisation) |
| Real-time | `lib/echo.ts`, `lib/realtime.ts`, `components/workspace/realtime.tsx` |
| Dates/time zones | `lib/datetime.ts` |
| UI text | `lib/i18n.ts` (English dictionary, ready for a `ms` dictionary) |

The workspace is client-rendered (Next.js SPA pattern) with TanStack Query for
server state. Next.js 16 Cache Components is enabled; pages that read URL data are
wrapped in `<Suspense>` as required.
