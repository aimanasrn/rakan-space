# RakanSpace

**Satu ruang. Satu pasukan.** — a multi-organisation workspace for team chat,
projects, tasks, calendars, announcements and files.

| | |
|---|---|
| Frontend | Next.js 16.4 (App Router, Cache Components), React 19.3, TypeScript 5.9, Tailwind CSS 4.3, shadcn/ui (Radix, "nova"), Lucide, TanStack Query 5 |
| Backend | Laravel 13.39 (PHP 8.4+), Sanctum 4.3 (cookie SPA auth), Reverb 1.12 |
| Real-time | Laravel Reverb + Laravel Echo 2.6 / pusher-js 8.6 |
| Data | PostgreSQL 17, Redis 7.4 (sessions, cache, queues) |
| Local mail | Mailpit |
| Dev environment | Docker Compose |

```
src/frontend   Next.js application          → src/frontend/README.md
src/backend    Laravel REST API              → src/backend/README.md
docs/          architecture, permissions, deployment
docker-compose.yml
```

## Quick start (Docker)

Requirements: Docker with Compose v2. Nothing else needs to be installed.

```bash
docker compose up -d --build
```

First start installs dependencies, runs migrations and seeds the demo data
(a few minutes). Then open:

| Service | URL |
|---|---|
| App | http://localhost:3000 |
| API | http://localhost:8000 |
| Mailpit (all outgoing email) | http://localhost:8025 |
| Reverb WebSocket | ws://localhost:8080 |
| PostgreSQL | localhost:**5433** (user/password `rakanspace`/`secret`) |
| Redis | localhost:**6380** |

Postgres and Redis use non-default host ports so the stack can run next to other
projects. Override any host port with environment variables such as
`FRONTEND_HOST_PORT`, `BACKEND_HOST_PORT`, `POSTGRES_HOST_PORT` (see
`docker-compose.yml`). If your user ID is not 1000, set `HOST_UID`/`HOST_GID`.

Use **http://localhost:3000** (not 127.0.0.1) so the browser shares the session
cookie between the app and the API.

Services: `frontend`, `backend` (API), `queue` (notifications and broadcasts),
`scheduler` (reminders, cleanup), `reverb`, `postgres`, `redis`, `mailpit`.

### Running without Docker for the apps

Start only the data services with `docker compose up -d postgres redis mailpit`,
then follow `src/backend/README.md` and `src/frontend/README.md`.

## Demo accounts

All demo passwords are **`password`**. The data is fictional.

| Person | Email | Rakan Teknologi Sdn Bhd (`rakan-tech`) | Kopi Kita Trading (`kopi-kita`) |
|---|---|---|---|
| Aisyah Rahman | aisyah@rakantech.test | **Owner** | – |
| Daniel Lim | daniel@rakantech.test | **Admin** | Staff |
| Priya Nair | priya@rakantech.test | Manager | – |
| Hafiz Ismail | hafiz@rakantech.test | Staff | – |
| Tan Mei Ling | meiling@rakantech.test | Staff | – |
| Farah Kamal | farah@kopikita.test | – | **Owner** |
| Zulkifli Osman | zul@kopikita.test | – | Manager |
| Siti Nurhaliza Yusof | siti@kopikita.test | – | Staff |

Things to try:

- Sign in as **Daniel** and use the workspace switcher: Admin in one organisation, Staff in the other.
- Sign in as **Aisyah** (Owner): she cannot see the private Hafiz↔Priya DM or the
  "Sprint 14 planning" meeting she is not invited to. Owner rights do not open private conversations.
- Sign in as **Farah**: nothing from Rakan Teknologi is reachable, even by guessing IDs in the URL.
- Open two browsers (e.g. Hafiz and Priya) on `#engineering` to see real-time messages,
  unread counts and notifications.
- Invite someone from **Members → Invite people**, then open the email in Mailpit.
- Sign in as **Priya** → **Approval**: Hafiz's keyboard purchase is waiting for her.
  Approve it, then sign in as **Hafiz** to see it approved (and the email in Mailpit).
- Sign in as **Tan Mei Ling** → **Form → My submissions**: her leave request was
  returned for changes; edit and resubmit it. Her RM 8,200 workstation passed her
  manager and now waits for Finance (**Daniel**), because the workflow adds a
  Finance step above RM 5,000.
- Sign in as **Daniel** → **Form → Manage forms** → *Purchase Request* to see the
  builder (drag-and-drop fields, show/hide rules, preview, publish versions).
- Sign in as **Hafiz** → **Timesheet**: this week is in progress, last week is waiting
  for Priya. Sign in as **Priya** → **Approval** to approve it, or **Timesheet → Team**
  and **Reports**. **Tan Mei Ling**'s last week was returned with a comment.
- Sign in as **Daniel** → **Helpdesk** (he is the listed agent): Mei Ling's VPN ticket
  has an internal note she cannot see, and Hafiz's monitor request is unassigned.
  Sign in as **Tan Mei Ling** to see the same ticket from the requester's side.
- Sign in as **Hafiz** → **Opportunity**: he sees only his Kedai Maju deals. Sign in
  as **Priya** (his manager) to see the whole pipeline and the forecast; drag a deal
  to *Won* or *Lost*.

## Common commands

| Task | Command |
|---|---|
| Start / stop | `docker compose up -d` / `docker compose down` |
| Logs | `docker compose logs -f backend queue reverb frontend` |
| Reset database + demo data | `docker compose exec backend php artisan migrate:fresh --seed` |
| Backend tests | `docker compose exec backend php artisan test` (uses the `rakanspace_test` database) |
| Frontend type check | `cd src/frontend && npm run typecheck` |
| Frontend lint | `cd src/frontend && npm run lint` |
| Frontend production build | `cd src/frontend && npm run build && npm run start` |
| Run reminders now | `docker compose exec backend php artisan rakanspace:send-reminders` |
| Sync the app catalogue | `docker compose exec backend php artisan rakanspace:sync-apps` |
| Send approval reminders/escalations now | `docker compose exec backend php artisan rakanspace:approval-sla` |
| Send Helpdesk SLA alerts and auto-close now | `docker compose exec backend php artisan rakanspace:helpdesk-sla` |
| Remind members about unsubmitted timesheets now | `docker compose exec backend php artisan rakanspace:timesheet-reminders` |

## What is implemented

- **Auth and onboarding**: registration, login/logout, email verification,
  password reset, profile and avatar, create organisation → profile → invite
  teammates → dashboard. Invitations are single-use, expiring (7 days),
  hashed-token links bound to an email and role; resend rotates the token; revoke works.
- **Organisations and members**: multiple workspaces per user, switching,
  Owner/Admin/Manager/Staff roles per membership, ownership transfer with final-Owner
  protection, departments, searchable directory, deactivate/reactivate/remove
  with immediate revocation, audit log.
- **Chat**: public/private channels, 1:1 DMs, joining, channel membership,
  replies, @mentions, attachments, edit/delete states, unread counts and read
  positions, paginated history, real-time delivery, sending/sent/failed states
  with retry, idempotent sends, reconnection catch-up, drafts.
- **Projects and tasks**: members-only or organisation-visible projects, manager
  and members, dates, status, archiving, overview/activity/files; tasks with
  assignee (project members only), priority, due date, checklist, comments,
  attachments, activity history, list and Kanban views (drag-and-drop plus a
  keyboard-accessible "Move to" menu), search/filter/sort, My Tasks.
- **Calendar**: one-off events with participants or whole-organisation audience,
  location/meeting link, month and agenda views, task deadlines, reminders,
  organisation time zone.
- **Announcements**: organisation or department audience, attachments, pinning,
  optional acknowledgement with status for publishers, notifications.
- **Files**: private storage (local or S3-compatible), permission-checked
  downloads, safe inline previews, search and filters.
- **Notifications**: persistent per-organisation notifications for mentions,
  assignments, task updates, comments, deadlines, events/reminders and
  announcements; real-time push, unread counts, mark read / mark all read, deduplication.
- **Search and reports**: permission-aware search across messages, channels,
  projects, tasks and files; reports for status counts, completions, overdue
  tasks and project progress.
- **App launcher**: grid button in the top bar opens a launcher with
  admin-managed banners, installed apps (pin to the sidebar) and a marketplace
  (install, or request access as a non-admin). Per-app abilities per role
  (view/create/edit/delete/approve/admin), access requests with email + in-app
  notifications, and Settings → Apps for installs, permissions, requests and banners.
  Modules not built yet open a placeholder page.
- **Reporting lines**: each membership can have a reporting manager (Members → Reports to).
- **Approval**: workflow designer (sequential steps; approvers by person, role or
  reporting manager; "any one" or "everyone" per step; conditional steps such as
  amount > 5,000; time limits with reminders and escalation), inbox and
  "my requests", approve / reject / return with comments, resubmit after return,
  withdraw, out-of-office delegation, full history. Other modules call
  `Approvals::submitForApproval()` and react to `ApprovalRequestStatusChanged`.
- **Form**: drag-and-drop builder (text, long text, number, date, dropdown, single
  choice, checkboxes, file upload, signature, table/repeater), required and
  validation rules, show/hide logic, versions with publish/close, audience by
  role and department, one or many responses, optional approval workflow,
  "my submissions" with status, responses per form.
- **Timesheet**: weekly grid per project/task (or general time) with notes,
  "copy last week's rows", 24 h/day limit, submit for approval through a
  configurable workflow (reporting manager by default), return/resubmit,
  withdraw, team view for managers and approvers, reports by project, person,
  task or week with CSV export, and a reminder for unsubmitted weeks.
- **Helpdesk**: internal service desk. Members raise tickets (with files); agents
  work queues (assigned to me, unassigned, all), reply or add internal notes,
  insert canned responses, assign, set status/priority/category. SLA targets per
  priority with "due soon"/"missed" alerts, auto-close of resolved tickets, and
  settings for agents, targets and categories.
- **Opportunity**: shared accounts and contacts, a Kanban pipeline (drag-and-drop
  or "Move to"), won/lost with a reason, notes/calls/meetings/emails and follow-up
  tasks, a weighted forecast by month, and editable pipeline stages. Staff see their
  own deals; reporting managers and sales managers see their team's.
- **UI**: collapsible sidebar, workspace switcher, Ctrl/⌘+K search,
  notifications menu, profile menu, light/dark themes, mobile navigation,
  loading/empty/error states, confirmations for destructive actions, keyboard
  focus styles, labelled controls. UI text is centralised in `src/frontend/src/lib/i18n.ts`.

Details: [architecture](docs/architecture.md) · [permission matrix](docs/permissions.md) ·
[deployment, email, broadcasting, storage, backups](docs/deployment.md).

## Assumptions and decisions

- Channels and direct messages share one `conversations` table (DMs are 1:1;
  group conversations are private channels).
- Owners/Admins can see and manage **all projects** (business data they administer)
  but **not** private channels, DMs or events they are not invited to.
- Managers can publish organisation-wide announcements and to departments they belong to.
- Real-time events carry identifiers only; content is always fetched through the
  permission-checked API.
- The workspace UI is client-rendered (Next.js SPA pattern) because every screen
  depends on the signed-in user. Next.js dev-time "instant navigation" validation is
  set to opt-in for that reason (see `next.config.ts`).
- Auth emails are sent synchronously so delivery failures are reported, not hidden.
  In-app notifications are queued.
- Default organisation time zone: Asia/Kuala_Lumpur.

## Known limitations

- Search uses `ILIKE` (fine for small and medium workspaces). Large deployments
  should add Postgres full-text indexes or a search engine.
- No message threads view (replies are shown inline with a quote), reactions,
  typing indicators or presence.
- Email copies of in-app notifications are opt-in per notification type; so far
  only app access requests and their decisions send email. There are no per-user
  email preferences yet.
- Task deadline reminders are sent once, the day before the due date.
- An already-open WebSocket subscription is not force-closed when access is revoked;
  it receives only IDs (no content), cannot fetch content, cannot re-subscribe, and
  the client is told to leave via `access.revoked`.
- No automated browser tests are committed. Verification used scripted API and
  headless-browser checks (see the final report). Bahasa Melayu text is not yet translated.

## Future scope (not implemented)

Attendance and check-in/out · Leave balances · Expense claims ·
Subscription billing · Guest access · Platform
administration portal · Native mobile apps · External calendar integrations
(Google/Microsoft) and recurring events · Voice/video calling.
