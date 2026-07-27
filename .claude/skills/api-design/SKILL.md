---
name: api-design
description: Route/validation/auth/error-envelope conventions for apps/server. Read before adding or changing any Node API endpoint.
---

Read before adding or changing any endpoint in `apps/server`. Established in Phase 2 task 2.0
(`apps/server/src/config`, `src/middleware`, `src/services`) — the foundation every session/points
endpoint builds on.

## Config
- All required env vars are validated once, at boot, by `src/config/env.ts` (`loadEnv`, a zod schema).
  Missing/malformed → the process crashes immediately with a message naming the bad var, never a
  confusing failure deep in a request handler. Add a new required var to the schema, not as an ad hoc
  `process.env.X` read elsewhere.
- `loadEnv` is a **pure function**: it takes a source object, never reads `process.env` itself.
  `src/server.ts` is the one place `process.env` is read directly (after `dotenv.config()`); every
  other module receives the already-validated `Env` object as a parameter. Tests inject a fixture
  (`src/test-support/fixtures.ts`'s `TEST_ENV`) instead of touching real env vars.

## Request flow
- `createApp(env: Env)` in `src/app.ts` is the one Express factory — mirrors the existing
  `app.ts`/`server.ts` split (testable core vs runtime shell, [[code-style]]).
- Auth: `createRequireAuth(getKey)` (`src/middleware/require-auth.ts`) verifies the Supabase access
  token's signature against a `jose` `JWTVerifyGetKey` and attaches `req.auth = { userId }`. In
  production `getKey` comes from `createSupabaseJwks(env.SUPABASE_URL)`
  (`src/services/supabase-jwks.ts`) — Supabase signs access tokens **asymmetrically (ES256)** and
  publishes the verification key at `/auth/v1/.well-known/jwks.json`; `createRemoteJWKSet` fetches and
  caches it, so this is a no-round-trip check after the first request, not a per-request call to
  Supabase Auth. (An earlier version of this middleware verified against a shared `SUPABASE_JWT_SECRET`
  — the legacy HS256 scheme some self-hosted Supabase projects still use — until a real integration
  test against the local stack proved every token it issues is ES256-signed and got rejected. `getKey`
  is injected rather than hardcoded specifically so this can change again without touching the
  middleware.) Any route requiring a signed-in user takes this middleware; routes never parse the JWT
  themselves.
- Validation: zod schemas at the route boundary, one per endpoint, living next to its router in
  `src/modules/<domain>/`. Reject with a 400 `ApiError` on the first invalid field — never let an
  unvalidated body reach a service function.
- Errors: routes/services signal failure by `throw`ing or `next()`-ing an `ApiError(status, code,
  message)` (`src/middleware/api-error.ts`). `src/middleware/error-handler.ts`, registered **last** in
  `createApp`, is the one place that renders the JSON envelope `{ error: { code, message } }`. `code` is
  the API's real contract — a stable machine string the mobile app maps to an i18n key (same pattern as
  `AuthFailure.kind` in `apps/mobile/src/services/auth-service.ts`). `message` is diagnostic text for
  logs only, never guaranteed stable, never rendered directly. An error that isn't an `ApiError` is an
  unanticipated bug: logged in full server-side, rendered to the client as a generic `internal_error`
  with no leaked internals.

## Data access
- `getSupabaseAdminClient(env)` (`src/services/supabase-admin.ts`) is the server's one Supabase client,
  built with the **service-role key** — bypasses RLS *policies*. It does **not** bypass Postgres
  `GRANT`s: current Supabase CLI/platform default is that a brand-new table has no privileges for any
  Data API role, `service_role` included, until a migration grants them explicitly
  ([[supabase-integration]] — found the hard way when the create-session endpoint's own service-role
  insert 500'd with `permission denied`). Every write this client performs must already be authorized
  by the route/service code around it AND the target table must grant `service_role` the verb being used.

## Testing
- supertest against `createApp(TEST_ENV)` for route-level tests; unit tests for pure logic (env
  parsing, token signing/verification) that don't need an HTTP layer at all.
- `src/test-support/local-jwks.ts`'s `createTestJwks()` generates a real ES256 keypair and returns both
  a local (offline) `getKey` and a `mintToken()` — use it in any test exercising `require-auth` or a
  router behind it, so tests run the same signature-verification code path production uses, with no
  network call.
