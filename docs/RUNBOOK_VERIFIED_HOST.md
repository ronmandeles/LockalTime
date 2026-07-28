# Runbook — Granting `verified_host`

Per `CLAUDE.md`'s locked decision: Verified Host is **granted manually by flipping a DB flag in Supabase, no in-app application flow yet** (`docs/ARCHITECTURE.md` §10 — "manual admin approval (MVP — no self-serve approval flow)"). There is no admin screen and none is planned for MVP. This is the entire procedure.

## Prerequisite

You (the project owner) need a business's user id. Ask them to sign up first, then look up their id:

```sql
select id, display_name, role
from public.users
where display_name ilike '%their name or business%';
```

## Grant `verified_host`

Run against the **linked production project's** SQL editor (or `supabase db` locally for testing), as the `postgres`/table-owner role — never through the app or the Node API, which has no write grant on `users.role` at all (see `supabase/migrations/20260718015352_create_users.sql` and `20260729000000_grant_users_select_service_role.sql` — Node can only `select` it).

```sql
update public.users
set role = 'verified_host'
where id = '<their-user-id>';
```

## Revoke it

```sql
update public.users
set role = 'user'
where id = '<their-user-id>';
```

## Verify it took effect

```sql
select id, display_name, role from public.users where id = '<their-user-id>';
```

The user should now see the venue-management surface and be able to create a venue (`apps/mobile`'s venue screen, Phase 6 task 3) the next time they open the app — role is read fresh on every request that needs it (`apps/server/src/middleware/require-role.ts`), not cached in the client's session, so no sign-out/sign-in is required.

## Why this stays manual

- MVP has no volume that justifies a self-serve application flow, and a manual flip is a real anti-abuse gate in itself — a business has to be someone the owner has actually talked to.
- `public.users.role` is deliberately excluded from every column-scoped `UPDATE` grant given to `authenticated` (privilege-escalation guard, pgTAP-tested in `supabase/tests/users_test.sql`) and Node's own `service_role` grant is `select`-only (see above) — there is no write path for this column outside of running SQL directly as the table owner. That is intentional, not a gap: any future self-serve approval flow is a real, separate decision (`backlog.md`'s "known gaps" list), not something to quietly wire in now.
