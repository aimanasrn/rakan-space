# Deployment and operations

This repository does not deploy anything. These notes describe what a production
setup needs. Nothing here has been deployed or purchased.

## Topology

- **Frontend**: `npm run build && npm run start` (Node 20.9+ / 24 LTS), or any Next.js host.
- **API**: PHP 8.4+ behind Nginx/Caddy + PHP-FPM (not `artisan serve`).
- **Queue worker**: `php artisan queue:work redis --queue=default,notifications --tries=3 --backoff=10`
  under Supervisor/systemd, restarted on deploy (`php artisan queue:restart`).
- **Scheduler**: cron `* * * * * php artisan schedule:run` (or `schedule:work`).
- **Reverb**: `php artisan reverb:start` behind a TLS-terminating proxy that
  forwards WebSocket upgrades. Scale horizontally with `REVERB_SCALING_ENABLED=true` (Redis).
- **PostgreSQL 15+** (the schema uses `ON DELETE SET NULL (column)`), **Redis 7**.

Serve the SPA and API from the same registrable domain, e.g. `app.example.com` and
`api.example.com`, so session cookies work with `SameSite=Lax`.

## Backend production `.env`

```dotenv
APP_ENV=production
APP_DEBUG=false
APP_URL=https://api.example.com
FRONTEND_URL=https://app.example.com
CORS_ALLOWED_ORIGINS=https://app.example.com

SESSION_DRIVER=redis
SESSION_DOMAIN=.example.com
SESSION_SECURE_COOKIE=true
SESSION_SAME_SITE=lax
SESSION_ENCRYPT=true
SANCTUM_STATEFUL_DOMAINS=app.example.com

LOG_LEVEL=info
LOG_STACK=daily
```

Run `php artisan config:cache route:cache event:cache` on deploy and
`php artisan migrate --force`. Never run the demo seeder in production (it refuses to).

## Email

Laravel's mailer is used for verification, password reset and invitations. These
emails are sent synchronously so the API can report delivery failures (the UI
shows "created, but the email could not be sent" and offers Resend).

- Local: Mailpit (`MAIL_HOST=mailpit`, UI at http://localhost:8025).
- Production: any SMTP/API mailer supported by Laravel (SES, Postmark, Mailgun, …).
  Set `MAIL_MAILER`, credentials and a verified `MAIL_FROM_ADDRESS`.

## Broadcasting (Reverb)

```dotenv
BROADCAST_CONNECTION=reverb
REVERB_APP_ID=…  REVERB_APP_KEY=…  REVERB_APP_SECRET=…   # generate strong values
REVERB_HOST=ws.example.com  REVERB_PORT=443  REVERB_SCHEME=https   # where Laravel publishes
REVERB_SERVER_HOST=0.0.0.0  REVERB_SERVER_PORT=8080                 # where Reverb listens
```

Frontend: `NEXT_PUBLIC_REVERB_APP_KEY`, `NEXT_PUBLIC_REVERB_HOST=ws.example.com`,
`NEXT_PUBLIC_REVERB_PORT=443`, `NEXT_PUBLIC_REVERB_SCHEME=https`.

Channel authorisation goes through `POST /api/broadcasting/auth` with the session
cookie. Payloads carry IDs only, so the message content never transits Reverb.

## Private storage

Attachments, avatars and logos are stored on the disk named by `ATTACHMENTS_DISK`.

- `local` → `storage/app/private` (never web-served; downloads stream through the API).
- `s3` → any S3-compatible service (AWS S3, Cloudflare R2, MinIO, Garage):

  ```dotenv
  ATTACHMENTS_DISK=s3
  AWS_ACCESS_KEY_ID=…  AWS_SECRET_ACCESS_KEY=…  AWS_DEFAULT_REGION=…  AWS_BUCKET=…
  AWS_ENDPOINT=https://…            # for non-AWS providers
  AWS_USE_PATH_STYLE_ENDPOINT=true  # for MinIO/Garage
  ```

  Keep the bucket private (block public access). The API streams objects after
  checking permissions, so no public or long-lived URLs are issued.

Size limit: `ATTACHMENTS_MAX_KB` (default 20 MB). Also set `upload_max_filesize`
and `post_max_size` in PHP and the proxy's body size limit accordingly.

## Backups

- **PostgreSQL**: nightly `pg_dump --format=custom` (or managed snapshots) plus WAL
  archiving / point-in-time recovery for production. Test restores regularly.
- **Files**: enable bucket versioning or replicate `storage/app/private`.
  Database and file backups should be taken close together, since attachment
  rows reference stored paths.
- **Redis** holds sessions, cache and queued jobs only; it can be rebuilt.
  Losing it signs users out and drops in-flight jobs (notifications that were not yet
  delivered).

## Security checklist

- HTTPS everywhere; `SESSION_SECURE_COOKIE=true`; HSTS at the proxy.
- `APP_DEBUG=false`; strong `APP_KEY` and Reverb secrets from a secret manager.
- CORS restricted to the frontend origin; Sanctum stateful domains match it.
- Rate limits (see `AppServiceProvider`): auth 10/min/IP and 5/min/email,
  invitations 50/h, messages 60/min, uploads 30/min per user.
- Logs exclude passwords, tokens and message bodies; failed jobs log class and error only.
- Monitor `failed_jobs`, queue depth and Reverb connection counts.
