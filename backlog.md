# Lockal Time — Backlog

Tracked per our working contract: one atomic task at a time, test-first, this file updated (`[x]`) the moment a task closes, alongside any `.md` file whose claims changed.

## Phase 0 — Bootstrap
Prerequisites: none.

- [x] Monorepo scaffold (`apps/mobile`, `apps/server`, `supabase/`, `docs/`, `.claude/skills/`)
- [x] React Native app init (bare workflow, not Expo managed — needed for native modules; React Navigation + Zustand + XState per ARCHITECTURE.md §3) — RN 0.86.0 in `apps/mobile`, app id `com.lockaltime.app` set on both platforms, jest/lint/typecheck green (manual QA pending: compiling/running Android & iOS — no SDK platforms or Mac on this machine)
- [x] Node.js API skeleton (Express, TypeScript, Jest+supertest) — `npm install` + `npm test` + `npm run build` all verified green in `apps/server`.
- [x] Local Supabase project + CLI (`supabase start`), initial migration for `users` — local stack healthy, `users` table + RLS migrated locally and to the linked production project (`LockalTime`), pgTAP suite (12/12) green via `supabase test db`.
- [x] CI pipeline: lint + typecheck + test, green on empty-feature repo — GitHub Actions (`.github/workflows/ci.yml`): server/mobile/db jobs, Node 24, pgTAP via pinned supabase CLI; run 29637534378 fully green
- [x] `.claude/skills/` seeded: `code-style`, `typescript-strictness`, `supabase-integration`, `testing-standards` (later: `i18n`) — each a proper `SKILL.md` with `name`/`description` frontmatter

**DoD:** `npm test` and `npm run lint` pass on an empty-feature repo; local Supabase boots; CI pipeline green.

## Phase 1 — Auth & Onboarding (Screens 1–3)
Prerequisites: Phase 0.

- [x] i18n + RTL foundation: en + he locales, RTL-safe layout conventions, no hardcoded UI strings (decided in CLAUDE.md — both languages from day one) — react-i18next + react-native-localize behind `src/i18n/`, typed locale modules with compile-time + runtime key parity, `i18next/no-literal-string` lint rule, conventions in `.claude/skills/i18n/SKILL.md` (manual QA pending: on-device en↔he switch — `forceRTL` applies on next app start; see docs/MANUAL_QA.md)
- [x] Supabase Auth wiring: email first (fully tested); Google + Apple wired against placeholder config, "manual QA pending" until real credentials (per CLAUDE.md decision) — supabase-js client + email-OTP auth service + discriminated-union auth store wired into App bootstrap, config.toml Google/Apple placeholder blocks (manual QA pending: real OAuth credentials + native SDKs, end-to-end OTP flow — see docs/MANUAL_QA.md)
- [x] `users` row auto-created via trigger on signup — `handle_new_user()` SECURITY DEFINER trigger on `auth.users` (full_name → name → email local-part → 'user' fallback, ON CONFLICT DO NOTHING), pgTAP 26/26 locally; production push pending (manual, per CLAUDE.md)
- [x] Onboarding carousel (Screen 1) — 3-page FlatList carousel per DESIGN_GUIDELINES §9 (skip/Next/Get Started, dots, token sizing), design-token module `src/theme/tokens.ts` established, first-launch AsyncStorage gating in App; placeholder en+he copy flagged for the copy pass (manual QA pending: on-device RTL swipe/paging — see docs/MANUAL_QA.md)
- [x] Permission-priming screen copy/logic (Screen 2) — including the denied-permission fallback state — priming + denied states behind the `blockingPermissions` service contract (Phase-3-swappable placeholder), open-settings recovery + fail-open proceed-anyway, App flow Onboarding → Permission → Home; placeholder copy flagged (manual QA pending: real OS dialogs when the Phase 3 native module lands — see docs/MANUAL_QA.md)
- [x] Auth error states: wrong OTP, network failure, OAuth account-linking dialog — AuthScreen (Screen 3, two-step email OTP + Google/Apple via the `nativeSignIn` placeholder seam), three error states branched on `AuthFailure.kind` only, `provider_email_conflict` mapping (GoTrue collision codes) → account-linking dialog, auth gate completes the App flow Onboarding → Permission → Auth → Home; real email-OTP integration test (`apps/mobile/integration/`, `npm run test:integration`, runs in CI db job with Mailpit + custom `{{ .Token }}` email template) (manual QA pending: real provider collision + on-device session rehydration — see docs/MANUAL_QA.md)

**DoD:** new user can sign up via all 3 providers in local/dev; RLS tested — a user can only read/write their own `users` row.

## Phase 2 — Core Session State & Realtime (Screens 4–8 skeleton)
Prerequisites: Phase 1.

- [x] **API foundation** *(discovered during Phase 2 planning — `apps/server` was still the Phase 0 `/health`-only shell)*: fail-fast zod-validated env config (`src/config/env.ts`), memoized service-role Supabase client (`src/services/supabase-admin.ts`), `require-auth` middleware (`src/middleware/require-auth.ts`, verifies Supabase access tokens against Supabase's JWKS via `jose` — cached after the first fetch, no round-trip to Supabase Auth per request; corrected from an initial HS256-shared-secret design once a real integration test proved the local stack signs tokens asymmetrically, ES256 — see `src/services/supabase-jwks.ts`), one JSON error envelope (`ApiError` + `error-handler.ts`, `{ error: { code, message } }`), `.env.example` + `dotenv` wiring for local dev. New `.claude/skills/api-design/SKILL.md`. 19/19 tests green, lint/typecheck clean.
- [x] `sessions`, `session_participants`, `session_presence_intervals`, `session_host_assignments` migrations — plus `venues` (needed for the `sessions.venue_id` FK) and `device_attestations` (new — see below). `is_session_participant()` SECURITY DEFINER helper avoids RLS recursion between the read policies. All five tables: SELECT-only grant for `authenticated`, zero write grants (writes are Node-API/service-role only); `device_attestations` has no grant at all (Node-internal). `sessions` + `session_presence_intervals` added to the `supabase_realtime` publication. 56/56 pgTAP passing (`supabase/tests/venues_test.sql`, `supabase/tests/sessions_test.sql`).
- [x] Node: create-session endpoint (QR signing, `duration_mode` handling) — `POST /sessions` (`apps/server/src/modules/sessions/`): zod validation mirrors the DB CHECKs, `qr-token.ts` mints an HMAC-SHA256 token (timing-safe verification, per-mint nonce so regeneration invalidates the old token), `host_id` always from the verified JWT (never the body). `SessionsStore` seam (`sessions-store.ts`) so the service/router tests never touch a real Supabase client. New config constants (`src/config/constants.ts`): `QR_TOKEN_TTL_MINUTES`, `SESSION_MAX_PARTICIPANTS`. 35/35 server tests green, lint/typecheck clean.
- [x] Node: join-session endpoint (signature/expiry/capacity checks) — `POST /sessions/join` + `POST /sessions/:id/leave`. Validation order: HMAC signature checked in Node first (cheap, reveals nothing about which sessions exist for a garbage token), then a new atomic `join_session()` Postgres function (`supabase/migrations/20260726225700_create_join_session_function.sql`) row-locks the session (`select ... for update`) and checks existence/status/current-token-match/expiry/capacity/idempotent-rejoin in one statement — closes the TOCTOU race where two devices joining the last slot could both read "49 present" and both insert. Leave is a single scoped `UPDATE` closing the caller's own open interval (no race to guard). Real integration test proves a truly concurrent double-join at capacity=1 admits exactly one caller. 63/63 pgTAP, 54/54 server unit tests, 3/3 server integration tests green, lint/typecheck clean. **Correction found via the integration test:** `require-auth` was rewritten from HS256-shared-secret verification to JWKS-based (ES256) — the local stack signs real tokens asymmetrically, not with the shared secret assumed in task 2.0; see `src/services/supabase-jwks.ts` and the `api-design`/`supabase-integration` skill updates. Also discovered: `service_role` needs explicit table grants too (not just `authenticated`) on this Supabase CLI version — migrations updated.
- [x] Play Integrity (Android) / App Attest (iOS) check wired into create + join, **monitor-mode only** (log verdicts, no enforcement yet) — `apps/server/src/modules/attestation/`: `AttestationProvider` port (ports-and-adapters, same seam pattern as mobile's `nativeSignIn`/`blockingPermissions`), `recordDeviceAttestation()` is fail-open at two layers (a thrown provider error and a failed DB write are both swallowed, never block create/join), `device_attestations` rows carry the full raw response for Phase 6 re-analysis. Real Play Integrity/App Attest need credentials that don't exist yet (Google Play Console service account, Apple DeviceCheck key) — writing HTTP-calling adapters against unconfirmable API shapes was skipped in favor of `unconfiguredAttestationProvider`, a placeholder returning `verdict: 'not_configured'`; the pipeline around it (DB write, RLS, create/join wiring) is real and integration-tested end to end. Tracked in `docs/MANUAL_QA.md`. 58/58 server unit tests, 4/4 integration tests green.
- [x] Realtime channel wiring: Presence + Broadcast + Postgres Changes — `apps/mobile/src/services/session-channel.ts`: one channel `session:{session_id}`, `subscribeToSessionChannel()` wires Presence sync, four named Broadcast events (`host_migrated`, `session_ended`, `participant_joined`, `participant_left` — pure pass-through, UI-hint only per ARCHITECTURE.md §5), and filtered Postgres Changes on `sessions` + `session_presence_intervals` (the only trusted channel). Real integration test (`apps/mobile/integration/session-channel.integration.test.ts`) against the local stack proves both a Broadcast round-trip between two live clients and a real Postgres Changes delivery for a service-role write — the latter required signing the subscribing client in as a real participant, since Realtime's CDC stream turned out to enforce RLS on the *subscribing* connection (an unauthenticated client silently receives nothing). CI (`ci.yml`) no longer excludes the `realtime` service in the db job. 9/9 new unit tests (mocked channel), 3/3 mobile integration tests, 183/183 mobile unit suite green, lint/typecheck clean.
- [x] `useSession` hook — `apps/mobile/src/machines/session-lifecycle-machine.ts` replaces the Phase 0 placeholder with the real graph (`idle`/`pending`/`active`/`host_disconnected`/`participant_reconnecting`/`degraded_offline`/`completed`/`force_terminated` per ARCHITECTURE.md §6), 97 table-driven tests covering every (state, event) pair including every ignored one. `apps/mobile/src/services/session-repository.ts` hydrates directly from Supabase (RLS-protected — session data isn't money-equivalent, unlike writes) rather than the Node API; `apps/mobile/src/hooks/use-session.ts` composes hydrate → subscribe → feed events into the machine → expose `{ session, openIntervals, status }`, with Broadcast handlers proven to only ever drive the machine, never mutate `session` directly. 288/288 mobile unit tests, lint/typecheck clean.
- [x] Home / Create / Scan / Details screens wired to real data (no native blocking yet — sessions are "virtual") — `apps/mobile/src/services/api-client.ts` (typed, never-throws fetch wrapper for the Node API's WRITE endpoints only — create/join/leave; reads stay on session-repository.ts's direct Supabase path, a deliberate split along the money-equivalent boundary). Five screens, all real navigator routes (`apps/mobile/src/navigation/types.ts`, wired into `App.tsx`): **Home** — two-button entry (Create/Scan), no session-lookup on mount (that needs a decision not yet made, flagged inline); **Create Session** — mode/duration form → `POST /sessions` → navigates to Active Session with the id (+ QR token for dynamic_qr); **Scan** — manual QR-token entry only this phase (`services/qr-scanner.ts`: no camera dependency added — `react-native-vision-camera` needs Pod/Gradle linking this machine can't install-and-verify, deferred to Phase 3 alongside the rest of the native-module work; the seam's `ScanResult` type is ready for a camera adapter later); **Session Details** — the actual pre-join confirmation + `POST /sessions/join` call, every `JoinOutcome` failure code (`session_not_found`/`session_not_joinable`/`qr_token_expired`/`session_at_capacity`/`invalid_qr_token`) rendering its own message; **Active Session** — `useSession`-driven status/timer/live participant list (from `openIntervals`, tested under fake timers and re-rendering on a simulated CDC update). i18n en+he for all five screens, DESIGN_GUIDELINES token-based styling (no color palette, per §11). 323/323 mobile unit tests, lint/typecheck clean.

**DoD:** two devices/simulators can create and join the same session and see each other in a live participant list; Play Integrity verdicts are logged and visible for later analysis. **Verified via integration tests against the real local stack** (create→join→leave, concurrent-join-at-capacity, RLS, realtime Broadcast + Postgres Changes between two live clients, attestation pipeline) rather than two physical devices — this machine has no Android SDK platforms and no Mac (standing constraint, `CLAUDE.md`). A literal two-device run is manual QA pending; tracked in `docs/MANUAL_QA.md`.

## Phase 3 — Native Blocker Bridge
Prerequisites: Phase 2 (needs a real session to attach to).

**Planned 2026-07-27** (see conversation; reordered from a first-draft backlog to a contract-first sequence, matching the `blockingPermissions`/`nativeSignIn` seam pattern from Phases 1–2). Locked decisions:
- Blocked-category MVP list is final: **Social Networking, Games, Entertainment** (one JS constant, mapped to each platform's native category enum, passed into `start()` — not hardcoded per platform, so the list can change without a native rebuild).
- **No physical Android device available this phase** — Android native code is written and Gradle-build-verified (compiles clean) but not runtime-verified; same "manual QA pending" posture as iOS. The literal physical-device DoD below stays open until hardware exists.
- iOS gets a full real Swift implementation this phase (not a thin stub), verified via JS contract tests only (no Mac).
- Camera QR scanning (`react-native-vision-camera`, deferred from Phase 2 — see `docs/MANUAL_QA.md`) is folded in here since native Pod/Gradle linking work is already in flight this phase.

Task order:
- [x] 3.0 `AppBlockerModule` TS contract (`SessionBlockerConfig`, `BlockerStatus`, `BlockerEvent` union: `shield_triggered`/`service_killed`/`permission_revoked`/`battery_critical`) + fake implementation — contract test first. `apps/mobile/src/services/app-blocker.ts` (interface + deterministic no-op placeholder, same pattern as `blocking-permissions.ts`) + `apps/mobile/src/config/blocked-categories.ts` (locked `social`/`games`/`entertainment` constant, single source of truth for both platforms). 7/7 new tests, 330/330 mobile suite green, lint/typecheck clean.
- [ ] 3.1 `useAppBlocker` hook — starts/stops the blocker off session state; feeds `OFFLINE_TIMEOUT` into `session-lifecycle-machine.ts` (already has this event reserved); tracks local violation state for an inline banner (no new screen this phase — edge-case screens stay Phase 6)
- [ ] 3.2 Swap Phase 1's `blockingPermissions` placeholder (`apps/mobile/src/services/blocking-permissions.ts`) for the real Android seam, plus a battery-optimization-exemption ask alongside the existing Usage Access/Overlay grants on Screen 2
- [ ] 3.3 Android native: Foreground Service + `UsageStatsManager` polling (2s interval) + `SYSTEM_ALERT_WINDOW` overlay (not AccessibilityService — see ARCHITECTURE.md §4). Note: Android 14+ needs a declared `foregroundServiceType` (likely `specialUse` + Play Console justification) — flag in ARCHITECTURE.md §4 once built.
- [ ] 3.4 Android native: boot-persistence `BroadcastReceiver` on `BOOT_COMPLETED`, backed by `EncryptedSharedPreferences` (native-only storage — JS isn't running yet at boot)
- [ ] 3.5 Camera QR scanning: wire `react-native-vision-camera` into the Scan screen (Android + iOS linking)
- [ ] 3.6 iOS native: `FamilyControls` authorization + `ManagedSettings` shield + `DeviceActivityMonitor` extension + App Group bridge, same `AppBlockerModule` contract
- [ ] 3.7 Apple Family Controls entitlement application submitted (parallel track, not blocking dev)

**DoD:** on a physical device, starting a session actually blocks a test app; killing the app or rebooting the device does not lift the block prematurely.

## Phase 4 — Session Lifecycle Logic
Prerequisites: Phase 3.

- [ ] Points/bonus math as pure functions (base rate, group bonus, completion bonus, stacking) — **test-first**, spec fully confirmed in ARCHITECTURE.md §7
- [ ] Emergency exit flow end-to-end (Screen 9)
- [ ] Completion flow end-to-end (Screen 10)
- [ ] Host migration worker (Presence-timeout detection, highest-minutes-present promotion, `session_host_assignments` audit)
- [ ] Host-migration toast (new host only, calm, few seconds)
- [ ] Open-ended session 24h auto-close job
- [ ] Offline 30-minute native-enforced cutoff
- [ ] Screen 13 (Welcome Back / Session Interrupted) + rejoin flow reusing Session Details screen

**DoD:** full lifecycle (create → active → emergency-exit-or-complete) produces correct `rewards_history` rows, verified by integration test against the confirmed bonus spec; 2-device host-drop test correctly migrates within the debounce window; disconnect-and-rejoin test correctly disqualifies Completion Bonus but preserves earned base points.

## Phase 5 — Gamification & Stats (Screens 11–12)
Prerequisites: Phase 4 (needs real `rewards_history` data).

- [ ] **Retention-strategy analysis + gamification re-spec** (product-direction pivot — see ARCHITECTURE.md §1/§9 "under revision" notes + CLAUDE.md): analyze the addictive/retention techniques used by major consumer apps (variable rewards, streak pressure, notifications, social proof, etc.), rethink each for the less-phone-use goal, decide which to adopt, then rewrite ARCHITECTURE §1/§9 and the affected DoDs before building the mechanics below. Not blocked by Phase 4 — can (and should) be done earlier, since it also informs notification/engagement touchpoints in Phases 2–4.
- [ ] Streak calculation job (48h grace)
- [ ] Milestone crossing detection (global, periodic)
- [ ] `user_stats` / `user_stats_daily` write-through at session close
- [ ] History screen with Solo/Group/All filters + empty state
- [ ] Stats screen with 7-day chart

**DoD:** streak survives a 47h gap, breaks after 49h (both boundaries tested); Stats screen sum matches `rewards_history` exactly.

## Phase 6 — Hardening & B2B
Prerequisites: Phase 5.

- [ ] Remaining edge-case screens: QR expired/invalid/at-capacity, offline banner, late-join details
- [ ] Verified Host manual approval flow (admin-only)
- [ ] Static QR + `venues` table wiring
- [ ] In-app B2B dashboard screen (avg. session duration/customer, concurrent active customers), gated by `verified_host` role
- [ ] Root/jailbreak detection — flag session "unverified," exclude from group bonus only
- [ ] Play Integrity/App Attest enforcement turned on (graduated: lowest tier excluded from bonus/streak only, never blocks usage) — based on Phase 2's monitor-mode data

**DoD:** every edge case has an explicit screen/state, covered by a test or documented manual QA step; B2B screen shows correct live metrics for a verified host account.

## Phase 7 — Release Prep
Prerequisites: Phase 6.

- [ ] Restore Android release ABIs: `apps/mobile/android/gradle.properties` `reactNativeArchitectures` is set to `arm64-v8a` only — a single ABI for fast dev builds against the physical phone over USB (this PC's GPU can't run the emulator) — restore the real device set (at least `arm64-v8a,armeabi-v7a,x86_64`) before any Play Store build
- [ ] App Store Screen Time entitlement — confirm approval status, or document fallback plan
- [ ] Privacy nutrition labels (confirm: no geolocation, no contacts collected)
- [ ] Detox/Maestro E2E suite across golden paths (create → join → complete; create → emergency exit)
- [ ] Load-test Realtime channel at target concurrency

**DoD:** E2E suite green on CI against staging Supabase; entitlement approved or fallback documented.

