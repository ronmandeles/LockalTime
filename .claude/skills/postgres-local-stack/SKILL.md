---
name: postgres-local-stack
description: The plain-Postgres local stack, migration runner, and pgTAP runner that replace the Supabase CLI (Phase 10). Read before touching migrations, pgTAP tests, or the local database.
---

Read before any task touching a migration, a pgTAP file, or the local
database. Introduced by Phase 10 task 10.1
([docs/POSTGRES_MIGRATION_PLAN.md](../../../docs/POSTGRES_MIGRATION_PLAN.md)).
Task 10.7 folds this into a full `postgres-integration` skill replacing
[[supabase-integration]]; until then **both stacks exist** and the rules below
say which to use.

## Two stacks, deliberately

| | Supabase CLI stack | This stack |
|---|---|---|
| Start | `npx supabase start` | `npm run db:up` (from `apps/server`) |
| Postgres | `127.0.0.1:54322` | `127.0.0.1:55432` |
| Mail | 54324 | 55026 (SMTP 55025) |
| Status | still what production mirrors | what Phase 10 is building toward |

Ports are in the 554xx range specifically so both run side by side: a store
ported in 10.3 can be checked against the behaviour it replaces without
stopping anything. Do not "tidy" them onto Supabase's ports.

## Commands

From `apps/server`:

```sh
npm run db:up        # build + start Postgres 17 (with pgTAP) and Mailpit
npm run db:migrate   # apply db/bootstrap/ then supabase/migrations/
npm run db:test      # run every file in supabase/tests/, exit non-zero on any failure
npm run db:down      # stop the stack
```

`npm run db:migrate` replaces `supabase db push`; `npm run db:test` replaces
`supabase test db`. Neither talks to a hosted project — both default to the
local container and take `DATABASE_URL` to override.

## Migration rules the runner now enforces

Forward-only was a convention trusted to discipline; it is now checked in
code (`src/db/migration-runner.ts`), and the runner **refuses the whole run**
rather than applying a partial set:

- **`checksum_drift`** — an applied migration's SQL was edited. Never edit an
  applied migration; add a new one. Checksums normalize CRLF to LF, because
  this repo's files are LF in git and CRLF in a Windows working tree — hashing
  raw bytes would make every migration read as drifted between here and CI.
- **`missing_applied_file`** — a migration in the ledger is gone from disk.
- **`out_of_order`** — a new migration is timestamped before one already
  applied. It would run after its successors here and before them on a fresh
  database: one ledger, two schemas. Rename it with a current timestamp.

Each migration applies in **its own transaction**, so a failure leaves the
database at the last complete migration. All 22 current files are
transaction-safe; if you ever need `CREATE INDEX CONCURRENTLY`, it cannot go
in a migration as-is and needs its own path.

## The ledger lives outside `public`

`migrations.history`, never `public.schema_migrations`. Every one of the 16
tables the migrations create has RLS enabled, and an un-policied bookkeeping
table in `public` would be a permanent exception to that rule — and would
break the integration test that asserts it. Put any future infrastructure
table in its own schema for the same reason.

## pgTAP: a file that produces nothing is a failure

`src/db/tap-parser.ts` treats a missing or unmet plan as a failure, not just
a `not ok` line. This matters because a syntax error or a missing relation
makes the file abort before pgTAP emits any assertion at all — zero failures
and zero assertions must never read green. Verified against all four modes
(failing assertion, missing relation, syntax error, unmet plan).

Always keep the `select plan(n)` count accurate. It is the only thing that
catches a file dying halfway with every assertion that did run passing.

After a file aborts, the runner rolls the connection back before the next
file, so one broken file cannot cascade into false failures.

## The Supabase compat bootstrap is temporary

`db/bootstrap/000_supabase_compat.sql` supplies the objects the migrations
still expect — roles `anon`/`authenticated`/`service_role`, the `auth` schema
with `users` and `uid()`, and an empty `supabase_realtime` publication — so
all 22 migrations and all 15 pgTAP files run **unchanged**. That is the point:
10.1 proves the schema ports while the authorization predicate is untouched,
so when 10.2 swaps `auth.uid()` for `app.current_user_id()` the identity
change is the only suspect for a red suite.

**Task 10.2 deletes this file.** Do not build anything new on top of it, and
do not add to it to make some other task easier — anything that needs to
outlive 10.2 belongs in a real migration.
