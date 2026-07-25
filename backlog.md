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

- [ ] `sessions`, `session_participants`, `session_presence_intervals`, `session_host_assignments` migrations
- [ ] Node: create-session endpoint (QR signing, `duration_mode` handling)
- [ ] Node: join-session endpoint (signature/expiry/capacity checks)
- [ ] Play Integrity (Android) / App Attest (iOS) check wired into create + join, **monitor-mode only** (log verdicts, no enforcement yet)
- [ ] Realtime channel wiring: Presence + Broadcast + Postgres Changes
- [ ] `useSession` hook
- [ ] Home / Create / Scan / Details screens wired to real data (no native blocking yet — sessions are "virtual")

**DoD:** two devices/simulators can create and join the same session and see each other in a live participant list; Play Integrity verdicts are logged and visible for later analysis.

## Phase 3 — Native Blocker Bridge
Prerequisites: Phase 2 (needs a real session to attach to).

- [ ] Android: Foreground Service + `UsageStatsManager` polling + `SYSTEM_ALERT_WINDOW` overlay (not AccessibilityService — see ARCHITECTURE.md §4)
- [ ] Android: boot-persistence `BroadcastReceiver` on `BOOT_COMPLETED`
- [ ] iOS: `FamilyControls` authorization + `ManagedSettings` shield + `DeviceActivityMonitor` extension + App Group bridge
- [ ] Unified `AppBlockerModule` JS interface (`start/stop/getStatus` + event emitter)
- [ ] `useAppBlocker` hook reconciling native events with session state
- [ ] Apple Family Controls entitlement application submitted (parallel track, not blocking dev)

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

