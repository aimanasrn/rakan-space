# RakanSpace API (Laravel)

Laravel 13 REST API with Sanctum cookie authentication, Reverb broadcasting,
PostgreSQL and Redis. See the [root README](../../README.md) for the full stack and
[docs/](../../docs) for architecture and the permission matrix.

## Requirements

PHP 8.4+ with `pdo_pgsql`, `intl`, `pcntl`, `zip`, `bcmath`; Composer 2;
PostgreSQL 15+; Redis 7. Redis is accessed through `predis`, so no PHP extension is needed.

## Setup (without Docker for the API)

```bash
# data services from the repo root
docker compose up -d postgres redis mailpit

cd src/backend
cp .env.example .env          # defaults point at the Docker ports 5433 / 6380 / 1025
composer install
php artisan key:generate
php artisan migrate --seed    # demo organisations and accounts
```

Run the API, queue worker, scheduler and Reverb (separate terminals or background):

```bash
php artisan serve --port=8000 &
php artisan queue:work redis --queue=default,notifications --tries=3 &
php artisan schedule:work &
php artisan reverb:start --port=8080
```

## Tests

```bash
php artisan test
```

Tests run against the `rakanspace_test` PostgreSQL database (created by
`docker/postgres/init.sql`). They cover organisation isolation and guessed IDs,
role and private-resource permissions, invitation rules, cross-organisation
references, immediate revocation on removal, tasks, message retry
deduplication, real-time channel authorisation, private attachments, search
visibility, reminder deduplication and the full main user journey.

## Layout

| Path | Purpose |
|---|---|
| `routes/api.php` | All endpoints (`/api/auth/*`, `/api/orgs/{slug}/*`) |
| `routes/channels.php` | Real-time channel authorisation |
| `routes/console.php` | Scheduled jobs |
| `app/Support/Permissions.php` | Every resource access rule |
| `app/Http/Middleware/ResolveOrganization.php` | Active-membership check per request |
| `app/Http/Controllers` | One controller per module |
| `app/Support/Notifier.php`, `app/Jobs/DeliverNotifications.php` | Notifications |
| `database/seeders/DemoSeeder.php` | Fictional demo data (refuses to run in production) |

## API conventions

- Responses: `{ "data": … }`, with `meta` for pagination. Errors: `{ "message": … }`.
  Validation errors are `422` with `{ "message", "errors": { field: [..] } }`.
- Non-members of an organisation, and inaccessible resources, get `404` (existence
  is not revealed). Permission failures on visible resources get `403`.
- SPA auth: `GET /sanctum/csrf-cookie`, then send `X-XSRF-TOKEN` with cookies
  (`credentials: "include"`) from an origin listed in `SANCTUM_STATEFUL_DOMAINS`.

## Scheduled and queued work

| Job | When |
|---|---|
| `rakanspace:send-reminders` | Every minute: event reminders and "due tomorrow" tasks (deduplicated) |
| `rakanspace:prune-attachments` | Hourly: delete uploads never linked to anything after 24 h |
| `queue:prune-failed` | Daily |
| `DeliverNotifications` | Queue `notifications`, 3 tries with backoff |
| Broadcast events | Queue `default`, dispatched after commit |
