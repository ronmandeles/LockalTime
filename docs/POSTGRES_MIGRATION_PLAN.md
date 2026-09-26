# Phase 10 — Replace Supabase with plain Postgres

**Owner-approved 2026-09-26.** Task state lives in `backlog.md`'s Phase 10
section; this document is the reasoning behind it.

Owner decision (2026-09-26): move off Supabase entirely onto a plain Postgres
database, replacing its Auth, Data API and Realtime services with code in
`apps/server`. This document is the plan that decision needs before any task
opens, per `task-workflow`.

## Why this is a phase and not a config change

Supabase provides four distinct services here — database, auth, data API,
realtime — and only the first is replaceable by "a Postgres DB". The table
below breaks those four out by how they are actually reached from our code.

| Supabase service | Where it is used | Ports to plain Postgres? |
|---|---|---|
| Postgres | 22 migrations, 15 pgTAP files | **Yes**, directly |
| `SECURITY DEFINER` functions | ~10 (`join_session`, `join_venue_session`, `apply_session_stats`, `rejoin_session`, the friend-request pair, `get_venue_metrics`, `is_session_participant`, `claim_streak_risk_notifications`) | **Yes**, directly |
| Auth | `apps/mobile/src/services/auth-service.ts` — `signInWithOtp`, `verifyOtp`, `signInWithIdToken`, `signOut`; `handle_new_user` trigger on `auth.users` | No — rebuilt in the Node API |
| Data API (PostgREST) | **21 direct client call sites**: 16 reads + 5 writes across 5 mobile repository files | No — becomes Node API endpoints |
| Realtime | `apps/mobile/src/services/session-channel.ts` — Presence, Broadcast, and Postgres Changes on `session_participants` + `session_presence_intervals` | No — rebuilt as WS + `LISTEN`/`NOTIFY` |
| RLS keyed to its JWT | 22 policies, 23 `auth.uid()` calls in 7 migration files | Needs a new identity source (see §2) |

## Decisions taken (owner, 2026-09-26)

1. **Hosting: local only for now.** Docker Postgres; the managed-host choice
   is deliberately deferred to task 10.8. Nothing in 10.1–10.7 depends on it.
2. **Auth: built in the Node API.** Email OTP plus Google/Apple OIDC
   id-token verification, ES256 tokens signed with `jose`, our own JWKS
   endpoint. No third-party auth vendor.
3. **Data path: every client DB call moves into the Node API.** No PostgREST
   replacement. The mobile app stops holding a database client entirely.
4. **Realtime: WebSocket in Express + Postgres `LISTEN`/`NOTIFY`.**

## Two findings that make this tractable

**The server's auth seam is already injected.** `createRequireAuth(getKey)`
([require-auth.ts:37](../apps/server/src/middleware/require-auth.ts#L37)) takes a
`JWTVerifyGetKey` rather than constructing one. Swapping issuers is a
one-line change at the call site — `createLocalJwks()` in place of
`createSupabaseJwks()` — not a sweep through the request path. Both sides
already speak ES256-over-JWKS, so the token *shape* does not change either.

**The money-equivalent logic never depended on Supabase.** It lives in Node
and in `SECURITY DEFINER` Postgres functions, both of which survive the move
untouched. This migration does not reopen `CLAUDE.md`'s first non-negotiable.

## §2 — The RLS identity shim (the keystone)

The 22 RLS policies are worth keeping: they encode real authorization rules
and the pgTAP suite proves them. They only depend on Supabase through
`auth.uid()`.

Replace that one function:

```sql
create schema if not exists app;

-- Mirrors what auth.uid() did: the current request's user, or NULL when
-- unauthenticated. The Node API sets this per transaction; `true` as the
-- second argument makes a missing setting return NULL instead of raising.
create function app.current_user_id() returns uuid
  language sql stable
  as $fn$ select nullif(current_setting('app.user_id', true), '')::uuid $fn$;
```

Every query the API runs on a user's behalf opens a transaction and issues
`SET LOCAL app.user_id = $1` first. `SET LOCAL` is transaction-scoped, so it
cannot leak between pooled connections — the property that makes this safe.

Consequences:

- The 23 `auth.uid()` call sites become `app.current_user_id()` — mechanical.
- The pgTAP suite sets a GUC instead of impersonating a Supabase role, which
  is *simpler* than what it does today.
- RLS stops being the client-facing boundary and becomes defence-in-depth
  behind the API. That is a strict improvement on the trust story in
  `ARCHITECTURE.md` §3, not a regression: there is no longer any path from a
  modified client to the database at all.

**Open question for 10.2:** the policies were written across 7 migrations and
`supabase-integration` forbids editing an applied migration. For a database
being rebuilt from scratch, a squashed baseline is cleaner than 22
`drop policy` / `create policy` pairs. Which one applies depends on whether
production data is being carried over — see §4.

## §3 — Task breakdown

Each task is TDD, atomic, and closed fully before the next opens.

### 10.1 — Local Postgres stack replaces `supabase start`

`docker-compose.yml` with Postgres 17 + pgTAP + Mailpit (the e2e suite
already reads OTPs from Mailpit). A migration runner to replace
`supabase db push`: the files are already timestamped SQL, so this is an
ordered apply plus a `schema_migrations` ledger. A replacement for
`supabase test db` that runs the 15 pgTAP files.

**Test first:** a fresh database applies all 22 migrations and the full
pgTAP suite passes.

### 10.2 — The `app.current_user_id()` shim

Per §2. Closes with the pgTAP suite green against the new predicate — this is
the task that proves the authorization rules survived.

### 10.3 — Node API off `supabase-js`

Replace `supabase-admin.ts` with a `pg` Pool (`pg` is already a dependency)
plus a `withUser(userId, fn)` helper owning the `SET LOCAL`. Then port the
7 stores **one per sub-task**, each with its integration suite rewritten:
`users`, `sessions`, `venues`, `friends`, `notifications`, `attestation`,
and `session-realtime-port`.

### 10.4 — Auth in the Node API

New tables for identities and OTP challenges (expiry, attempt ceiling,
single-use). Endpoints: request OTP, verify OTP, OIDC exchange, refresh,
sign out. ES256 keypair, `/.well-known/jwks.json`. Replaces the
`handle_new_user` trigger, which fired on `auth.users` — user-row creation
moves into the verify path. `require-auth.ts` changes by one line.

**Highest-risk task in the phase** — see §4.

### 10.5 — Endpoints for the 21 client call sites

Five sub-tasks mirroring the five repository files: `friends-repository`,
`session-repository`, `stats-repository`, `user-profile`, and the
`device_tokens` upsert. Each: server endpoint + tests, then the mobile
repository rewritten onto `fetch` against `api-config.ts`. The
`AuthResult<T>` discriminated-union convention at the service boundary stays
— it is about not throwing at a boundary, not about Supabase.

### 10.6 — Realtime: WS + `LISTEN`/`NOTIFY`

Triggers `NOTIFY` on `session_participants` and `session_presence_intervals`;
the API relays to `session:{session_id}` subscribers over WS, authenticating
the socket with the new JWT. Presence and Broadcast become server-held state
— `ARCHITECTURE.md` §5 already treats both as untrusted UI hints, so no trust
change. `session-channel.ts` is rewritten against the same handler interface
it exposes today, which keeps its consumers unchanged.

### 10.7 — Strip Supabase, rewrite the conventions

Remove `@supabase/supabase-js` from both workspaces; delete
`supabase-client.ts`, `supabase-config.ts`, `supabase-jwks.ts` and the
`react-native-url-polyfill` workaround that existed solely for the Supabase
client. Rewrite `.claude/skills/supabase-integration/` as
`postgres-integration` — binding conventions, so this lands in the same turn
as the code that invalidates them. Update `ARCHITECTURE.md` §3/§5,
`DATABASE.md`, `DEPLOYMENT.md`, `MANUAL_QA.md`, `PROJECT_STATUS.md`.

### 10.8 — Hosting, data migration, and only then cancellation

Owner-actioned. Pick and provision the managed host, migrate any real data
out of the `LockalTime` project, re-verify grants, deploy, smoke-test.

**Cancel Supabase only after this task is verified** — production runs on it
until then.

## §4 — Risks, stated plainly

**Self-built auth is the real risk.** Everything else here is a port of logic
that already exists and is already tested. Auth is new security-critical code:
OTP brute-force and enumeration, rate limiting, refresh-token rotation and
replay, key rotation, timing on the verify path. Email OTP is the mildest
form of this — no passwords are ever stored — but "mildest" is not "trivial".
Task 10.4 needs adversarial tests, not just happy-path ones.

**This migration removes the Realtime connection cap that motivated it.** The
Phase 7 load test found a plan-tier ceiling around 200–300 concurrent
connections against the 500 target. A single Node process holds 500
WebSockets without difficulty, so the ceiling moves from a vendor limit to
our own process — which is the outcome that backlog item wanted.

**But it introduces a single-instance constraint.** In-memory presence plus
per-connection `LISTEN` means horizontal scaling of the API breaks fan-out
until a Redis adapter exists. One instance is fine at launch scale; this must
be documented as a known ceiling rather than discovered later.

**Realtime is the least verifiable part, and the safety net is gone.** The
two-device create-join-see-each-other flow has never run here and still
cannot. Until now that path at least used a vendor-tested service; after
10.6 it is our code. `MANUAL_QA.md` gets a Phase 10 section, and 10.6's
integration tests have to carry more weight than usual.

**Unresolved, needed before 10.2 opens:** does the production `LockalTime`
project hold real user data that must be preserved? The app has only ever run
on an emulator, so the answer may be "none" — which would make a squashed
baseline migration the obvious choice and remove data migration from 10.8
entirely. Worth checking the dashboard before that task starts.

## §5 — What this costs

Roughly 20 atomic tasks across 8 groups, of which 10.3 and 10.5 are the bulk
by volume and 10.4 is the bulk by risk. For comparison, Phase 9 was 12 tasks.
Nothing in 10.1–10.7 requires a Mac, a physical device, or any credential
that does not already exist — which is unusual for this project and is the
main argument for doing it now rather than later.
