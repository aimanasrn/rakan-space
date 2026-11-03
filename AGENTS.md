# Working on RakanSpace

Read `README.md` and `docs/` first. The app is a modular monolith:

- `src/backend`: Laravel 13 API. **All business rules and authorisation live here.**
- `src/frontend`: Next.js 16 app. Presentation, routing and client state only.
  Next.js 16 has breaking changes: read `src/frontend/node_modules/next/dist/docs/`
  before touching framework-level code, and see `src/frontend/AGENTS.md`.

## Rules that must not regress

1. Every workspace endpoint lives under `/api/orgs/{organization}` with the `org`
   middleware and `scopeBindings()`. Never trust `organization_id`, roles,
   uploader IDs or user IDs sent by the client. Filter them through
   `Organization::filterActiveMemberIds()` or scoped queries.
2. Resource access goes through `App\Support\Permissions`. If you add a resource,
   add its rules there, and add a "visible…Query" if it appears in lists or search.
   Owner/Admin rights must not open private channels, DMs or private events.
3. Return 404 (not 403) for resources the user cannot see.
4. Broadcast events carry IDs only and implement `ShouldDispatchAfterCommit`.
5. Notifications go through `Notifier::send()` with a `dedupe_key` when repeats are possible.
6. Never log passwords, tokens or message bodies.
7. Removing a membership must not touch the user's other organisations, and must
   keep authored history.

## Verify before you finish

```bash
cd src/backend && php artisan test
cd src/frontend && npm run typecheck && npm run lint && npm run build
```

Add a feature test for any new permission rule, especially cross-organisation and
guessed-ID cases.
