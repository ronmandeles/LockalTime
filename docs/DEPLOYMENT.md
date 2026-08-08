# Deployment & Release Runbook

Phase 7 (Release Prep). Steps here are split into two kinds:
- **Done / automated** — code and config that exists in this repo now.
- **Owner-actioned** — real-world account creation, credential generation, or
  a one-time manual step that only the account owner can perform (needs a
  login, a payment method, or a physical device/keystore this environment
  doesn't have access to). Each is written as an exact runnable command or
  numbered steps, not just "set up X."

## Android release signing (owner-actioned)

`android/app/build.gradle` looks for `android/keystore.properties`
(gitignored) and, if present, wires a real `release` signing config; if
absent, `assembleRelease` falls back to the debug keystore so local release
builds still work before a real keystore exists. **A debug-signed build is
never acceptable for a real Play Store submission.**

To generate a real release keystore:

```sh
cd apps/mobile/android/app
keytool -genkeypair -v \
  -storetype PKCS12 \
  -keystore release.keystore \
  -alias lockaltime \
  -keyalg RSA -keysize 2048 -validity 10000
```

`keytool` will prompt for a store password, a key password, and identity
details (org name, etc.) — pick strong, unique passwords and store them in a
password manager. Then:

```sh
cd apps/mobile/android
cp keystore.properties.example keystore.properties
# edit keystore.properties: RELEASE_STORE_FILE=release.keystore,
# RELEASE_STORE_PASSWORD/RELEASE_KEY_PASSWORD = the passwords just chosen,
# RELEASE_KEY_ALIAS=lockaltime
```

**This keystore is effectively permanent**: Google Play ties an app's
identity to its signing key (Play App Signing can manage key rotation for
you once enrolled, but the *upload* key above still needs to exist first).
Back up `release.keystore` and its passwords somewhere durable and private
— losing it means losing the ability to publish updates to the same app
listing. Never commit it (already gitignored) or paste it into chat/issue
trackers.

For CI/PaaS builds, store the keystore's base64 contents and the three
passwords as secrets (GitHub Actions repo secrets / Railway env vars), never
as repo files — a CI step base64-decodes the keystore into
`android/app/release.keystore` and writes `keystore.properties` from the
secret values before running `./gradlew bundleRelease`.

## Android release ABIs

`android/gradle.properties`'s `reactNativeArchitectures` is the real device
set (`arm64-v8a,armeabi-v7a,x86_64`) as of this phase — restored from the
single-ABI (`arm64-v8a`-only) value Phase 3 used for fast USB-connected dev
builds. For a fast single-device dev loop, use React Native CLI's own flag
instead of changing the default:

```sh
npx react-native run-android --active-arch-only
```

## Production API hosting (Railway) — owner-actioned account, automated config

Decided (CLAUDE.md, confirmed 2026-07-29): **Railway**. `apps/server`'s
pollers (session sweep, streak expiry, streak-risk notifications — all
`setInterval` loops in `server.ts`) need a long-running process, which is
why this is a PaaS deploy, not a serverless function.

Owner-actioned (no CLI/API access from this environment):
1. Create a Railway account and a new project at railway.app.
2. Connect this GitHub repo, or deploy via the Railway CLI (`railway up`)
   from `apps/server/`.
3. Set these environment variables in the Railway project (Settings →
   Variables) — **never in the repo**:
   - `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` — from the production
     Supabase project's API settings (service-role key, not anon).
   - `QR_SIGNING_SECRET` — a long random string (e.g.
     `openssl rand -hex 32`), generated once and never rotated casually
     (rotating invalidates every currently-valid QR token).
   - `SENTRY_DSN` — once a Sentry project exists (see the Credentials
     runbook); omit until then, the server runs fine without it.
   - `PORT` — Railway sets this automatically; `server.ts` already reads
     `process.env.PORT` via `loadEnv`, no override needed.
4. Railway auto-detects Node from `package.json`/the Dockerfile below and
   runs `npm run build && npm start`.

Automated (this repo, done): `apps/server/Dockerfile` (below) — Railway can
build from either a detected Node buildpack or this Dockerfile; the
Dockerfile is included for portability to Render/Fly.io too, since none of
the three is irreversibly locked in.

## Staging Supabase project

Decided (CLAUDE.md): a second free-tier Supabase project, `LockalTime-staging`,
migrations applied there before prod, E2E/load tests target staging or
local, never production.

Owner-actioned (this environment has no Supabase login):
1. Create the project at supabase.com/dashboard — name it
   `LockalTime-staging`.
2. Note its project ref and API keys (Settings → API).
3. Log in and link locally:
   ```sh
   npx supabase login
   npx supabase link --project-ref <staging-project-ref>
   ```
4. Push every migration:
   ```sh
   npx supabase db push
   ```
5. **Re-verify `service_role` grants landed** — this is the exact miss
   `docs/MANUAL_QA.md` already documents twice for the production project
   (new tables get zero Data API privileges by default, `service_role`
   included, until a migration `GRANT`s them explicitly). Run:
   ```sh
   npx supabase db execute --linked --file scripts/verify-service-role-grants.sql
   ```
   (script below) and confirm every row shows `has_privilege = true`.

Automated (this repo, done): `scripts/verify-service-role-grants.sql` — the
same has_table_privilege query style `supabase/tests/phase6_hardening_test.sql`
already uses for the production Supabase, packaged as a standalone script
so it can run against staging (or prod) without pgTAP/a full test-db reset.

## CI: staging-deploy workflow

Automated (this repo, done): `.github/workflows/staging-deploy.yml` runs the
full unit/lint/typecheck suite, then (manual trigger or a `release/*`
branch push) deploys to Railway staging using repo secrets
(`RAILWAY_TOKEN`, staging Supabase's URL/service-role key). Owner-actioned:
add those secrets in GitHub repo Settings → Secrets and variables → Actions
once the staging Supabase project and Railway account exist above.

## iOS

See the Credentials runbook for Apple Developer Program status and the
Family Controls entitlement, and `.github/workflows/ci.yml`'s new
`ios-build` job (macOS CI) for the compile step.

## Realtime connection capacity (Supabase plan tier)

`apps/server/loadtest/realtime-load-test.js` (Phase 7 quality gate) found a
real Supabase Realtime **server-side connection cap** well below the
backlog's 500-concurrent target when run against the local stack
(`ConnectionRateLimitReached: Too many connected users` starting around
~200-300 concurrent connections) — not a bug, a plan-tier limit. Before
launch: confirm the production Supabase project's plan tier has a Realtime
concurrent-connection limit that actually supports the expected launch-day
scale (`loadtest/README.md` has the full finding and how to re-run this
against staging once it exists), and upgrade the plan or revise the target
down if not — see `backlog.md`'s Phase 7 quality-gates entry.

## Store-review posture for the app picker (Phase 9)

**There is nothing to declare on either platform.** That is the result of a
deliberate change, and worth knowing so nobody re-introduces the problem.

### Android — `QUERY_ALL_PACKAGES` was removed (2026-08-08)

The picker originally enumerated every installed app, which needs
`QUERY_ALL_PACKAGES` — a **restricted** permission requiring a Play Console
declaration, weeks of review, and carrying a real risk of outright refusal.

It is gone. Both platforms now offer the same fixed bundled catalog
([`APP_CATALOG.md`](APP_CATALOG.md)) and filter it via the manifest's
`<queries>` block, which names exactly the catalog's packages and needs no
declaration at all. Google's own guidance is to prefer `<queries>` over the
restricted permission for precisely this case.

- **Nothing to submit.** No App-access / sensitive-permission declaration.
- **Do not re-add it.** `__tests__/native-config.test.ts` fails if a
  `QUERY_ALL_PACKAGES` `<uses-permission>` element reappears — re-adding it
  silently re-imposes the declaration, the review delay and the refusal
  risk, and none of that fails a build.
- The `<queries>` list is generated from the catalog and pinned against it
  by the same test. Adding a catalog entry without adding its package there
  makes the picker quietly report the app as absent.

### iOS — `LSApplicationQueriesSchemes` (mention in review notes)

`Info.plist` declares 40 URL schemes so `canOpenURL` can filter the picker to
apps the host actually has. A documented API, well inside Apple's 50-entry
cap — but **the same mechanism is a known device-fingerprinting technique**,
and Apple has historically scrutinised long scheme lists.

Say so explicitly in the App Review notes rather than leaving it to be
inferred: the schemes are queried only to filter a user-facing picker to apps
the user already has, the result never leaves the device, and no scheme is
ever opened without the user's action.

It degrades gracefully if challenged — strip the schemes and the picker shows
the unfiltered catalog, which still works.