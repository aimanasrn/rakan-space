# RakanSpace web app (Next.js)

Next.js 16 App Router + TypeScript, Tailwind CSS 4, shadcn/ui (Radix), Lucide,
TanStack Query, Laravel Echo (Reverb). It talks to the Laravel API in `../backend`.

> Next.js 16 differs from older versions. Read `node_modules/next/dist/docs/`
> before changing framework-level code (see `AGENTS.md`).

## Setup

```bash
cp .env.example .env.local   # API at http://localhost:8000, Reverb at ws://localhost:8080
npm install
npm run dev                  # http://localhost:3000
```

The API must be running (see the root README). Open the app on `localhost`, not
`127.0.0.1`, so the Sanctum session and XSRF cookies are shared with the API.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Development server |
| `npm run typecheck` | Generate route types and type check |
| `npm run lint` | ESLint (Next.js + React hooks rules) |
| `npm run build` / `npm run start` | Production build and server |

## Structure

| Path | Contents |
|---|---|
| `src/app/(auth)` | Login, register, forgot/reset password, verify email |
| `src/app/onboarding` | Create workspace → profile → invite |
| `src/app/invitations/[token]` | Invitation landing and acceptance |
| `src/app/w/[org]/…` | Workspace routes. Each `page.tsx` wraps a client view in `<Suspense>` |
| `src/components/views` | One view per page |
| `src/components/workspace` | Shell: sidebar, header, search, notifications, real-time wiring |
| `src/components/{chat,tasks,projects}` | Feature components |
| `src/components/ui` | shadcn/ui components (generated, lightly adjusted) |
| `src/lib/api.ts` | Fetch wrapper (cookies, XSRF, error handling) |
| `src/lib/echo.ts`, `src/lib/realtime.ts` | Reverb connection and event bus |
| `src/lib/datetime.ts` | Organisation time-zone helpers; date-only deadlines never shift |
| `src/lib/i18n.ts` | Interface text dictionary (English; add `ms` for Bahasa Melayu) |

## Conventions

- Business rules and authorisation live in the API. The UI uses the `permissions`
  objects the API returns only to show or hide controls.
- Server state goes through TanStack Query keys in `src/hooks/use-workspace-data.ts`.
- Real-time events carry IDs only. Components refetch through the API.
- User-generated text is rendered as React text (escaped); only http(s) links are linkified.
