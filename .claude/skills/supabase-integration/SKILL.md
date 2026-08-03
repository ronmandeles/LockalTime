---
name: supabase-integration
description: Trust boundary, RLS/grants, migrations, and realtime conventions for Supabase. Read before any task touching the database, auth, or realtime.
---

Read before any task touching the database, auth, realtime, or migrations. The central rule flows from `ARCHITECTURE.md` §3: Supabase is the source of truth for *data*, but is **not** trusted to enforce money-equivalent business logic — that lives in the Node API.

## The trust boundary (non-negotiable)
- **Direct client → Supabase reads** are allowed only for read-only aggregates the user is entitled to see: home summary, history, stats (`ARCHITECTURE.md` §3). These are protected by RLS.
- **Any write that affects points, bonuses, QR validity, or session lifecycle goes through the Node API**, never a direct client `.insert()/.update()`. A modified client calling `supabase.from('sessions').update(...)` must not be able to forge state — RLS is a backstop, but the API is where the logic is enforced.
- Broadcast/Presence realtime messages are **UI hints only** (`ARCHITECTURE.md` §5). Never finalize points or trust session state from a Broadcast event; re-confirm against Postgres (CDC / authoritative read).

## Migrations
- All schema changes are timestamped SQL files in `supabase/migrations/` — the executable source of truth. `DATABASE.md` is the human-readable explanation and must be updated in the same task as any migration that changes shape.
- Migrations are forward-only and idempotent-safe to run on a fresh DB. Never edit a migration that has already been applied/committed; add a new one.
- Test every migration locally against `supabase start` before it's considered done.

## RLS
- RLS is **on** for every table holding user data. Default-deny; add explicit policies.
- A user can read/write only their own rows unless a policy deliberately widens it (e.g. a participant reading co-participants in a shared session). Every widening policy gets a comment explaining why it's safe.
- Write an RLS test for each policy: assert the owner can, and a non-owner cannot. (Phase 1 DoD requires this for `users`.)
- **RLS policies are not enough on their own.** New tables carry no DML privileges for `anon`/`authenticated` by default (only `REFERENCES`/`TRIGGER`/`TRUNCATE`) — the underlying Postgres `GRANT` must exist, or every query fails with `permission denied` regardless of any policy. Every migration needs explicit grants alongside its policies, e.g. `grant select on public.<table> to authenticated;`.
- **This applies to `service_role` too — it does not get free table privileges.** `service_role` bypasses RLS *policies*, but current Supabase CLI/platform default (`supabase/config.toml`'s `[api] auto_expose_new_tables` note: "new entities are NOT auto-exposed") means a brand-new table has **no** `GRANT` for any Data API role, `service_role` included. Found the hard way (Phase 2 task 2.3): the Node API's own service-role insert 500'd with `permission denied for table sessions` even though the code was correct — nothing was wrong except a missing `grant ... to service_role;`. Every table the Node API writes to needs both a client-facing grant (if any) AND a `service_role` grant, e.g. `grant select, insert, update on public.<table> to service_role;`.
- To make one column unwritable while others are (e.g. a user editing their profile but not their own `role`), grant `UPDATE` **column-scoped** (`grant update (display_name, avatar_url) on ... to authenticated;`) rather than table-wide — don't grant table-wide `UPDATE` and try to claw back one column with a column-level `REVOKE`, since a table-wide grant always wins over a column-level revoke in Postgres.

## Types & client
- Generate types with `supabase gen types typescript`; treat generated types as authoritative for row shapes (see [[typescript-strictness]]). Regenerate on every schema change.
- One shared client module per app (`apps/mobile/src/services/supabase-client.ts`, kebab-case per [[code-style]]), exposing a lazily-memoized `getSupabaseClient()`. Never scatter client construction; on React Native the client is constructed with AsyncStorage-backed `persistSession`, `autoRefreshToken: true`, `detectSessionInUrl: false`.
- Service-role keys live only on the Node server, never in the mobile app or any client-reachable place. The mobile app uses the anon key + user session only — `supabase-config.test.ts` enforces this by decoding the shipped key's JWT and asserting `role: 'anon'`.
- **React Native requires a URL polyfill, or `createClient()` throws at startup.** `apps/mobile/index.js` must import `react-native-url-polyfill/auto` **before** anything that constructs a client. `@supabase/supabase-js` derives its realtime endpoint by mutating a `URL` (`this.realtimeUrl.protocol = ...replace("http", "ws")`), but React Native's built-in `URL` (`Libraries/Blob/URL.js`) declares `protocol` as a getter with **no setter** — so the assignment throws `Cannot assign to property 'protocol' which has only a getter`, and because the client is built in App's first effect, the whole app fails to render. Found on the first real emulator run (2026-08-03); guarded by `apps/mobile/__tests__/url-polyfill.test.ts`.
- Note why the unit suite could not catch that: `supabase-client.test.ts` mocks `@supabase/supabase-js` virtually, so the real constructor never runs. Mocking the SDK is still correct for testing *our* construction options — but it means SDK-vs-platform incompatibilities are only ever caught on a device/emulator. Assume any new client-side SDK carries the same blind spot (see [[testing-standards]]).

## Auth service boundary (mobile)
- Screens never call `supabase.auth.*` directly: all auth flows go through `apps/mobile/src/services/auth-service.ts`, which wraps the shared client.
- Service functions return a discriminated `AuthResult<T>` (`{ ok: true; value } | { ok: false; error: AuthFailure }`) and **never throw** — Supabase `{ data, error }` responses and thrown unknowns are both normalized into typed failures at this boundary. Reuse this result pattern for any future client-side service that fronts an external SDK.
- `AuthFailure.message` is diagnostic text for logs, never rendered — screens map failure kinds/statuses to i18n keys.
- Auth state lives in the Zustand `auth-store` as a discriminated union; `attachAuthStateListener()` (attached/detached by the App bootstrap) is the only client-driven writer of auth state.

## Realtime specifics
- Per-session channel naming: `session:{session_id}` (`ARCHITECTURE.md` §5). Implementation:
  `apps/mobile/src/services/session-channel.ts`.
- Presence heartbeat drives host-liveness detection; do not build a parallel persisted heartbeat table (`DATABASE.md` design note).
- On reconnect, hydrate from an authoritative REST read first, then resume the CDC stream — don't assume in-memory Broadcast events survived the drop.
- **Postgres Changes (CDC) enforces RLS on the subscribing connection**, exactly like a REST read — found the hard way (Phase 2 task 2.5) when an unauthenticated (anon-role) test client subscribed successfully (status `SUBSCRIBED`) but silently never received any change event. Any code subscribing to `postgres_changes` must do so with a signed-in client's session already established; there's no separate "realtime access" grant to reach for when this fails, it's the same RLS SELECT policy as everywhere else.
