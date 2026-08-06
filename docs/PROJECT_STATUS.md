# Project Status

Phase-level narrative. **`backlog.md` is the authoritative per-task state** (the `[x]` checkboxes); this file is the "what happened and why it matters" layer on top of it, for a session that needs orientation without reading 245 lines of backlog.

Last updated: 2026-08-06.

## At a glance

| Phase | State |
|---|---|
| 0 — Bootstrap | Complete |
| 1 — Auth & Onboarding | Complete |
| 2 — Core Session State & Realtime | Complete |
| 3 — Native Blocker Bridge | Complete |
| 4 — Session Lifecycle Logic | Complete |
| 5 — Gamification & Stats | Complete |
| 5.5 — Push Notification Infrastructure | Complete (inert — no credentials) |
| 6 — Hardening & B2B | Complete |
| 6.5 — Social & Comparison Surfaces | Complete |
| 7 — Release Prep | Substantially implemented; owner-actioned items open |
| 8 — Black + Navy Theme & Onboarding Restyle | Complete (2026-08-04) |

Phase 7 was the last backlog phase; Phase 8 was added after it.

## Phase 0 — Bootstrap

Monorepo scaffold; Express + TypeScript + Jest API in `apps/server`; local Supabase with the `users` migration + RLS + pgTAP; `.claude/skills/` seeded; React Native 0.86 app in `apps/mobile` (bare, TS strict, React Navigation + Zustand + XState).

CI (GitHub Actions) green on `main`. Started as three jobs — server, mobile, db (lint/typecheck/test/pgTAP). `android-build` and `ios-build` were added later in Phases 7–8, so the workflow now has **five** jobs.

## Phase 1 — Auth & Onboarding

i18n/RTL foundation; email-OTP auth (unit tests **plus** a real integration test against the local stack, run by CI's db job); signup trigger creating the `users` row; Screens 1–3 with error states; App flow Onboarding → Permission → Auth → Home.

Google/Apple sign-in and every on-device check are manual-QA pending (`docs/MANUAL_QA.md`).

## Phase 2 — Core Session State & Realtime

Session schema and migrations; create/join Node endpoints; the Play Integrity / App Attest monitor-mode pipeline; realtime channel wiring; `useSession` + the lifecycle machine; Screens 4–8 wired to real data.

Sessions were still "virtual" at the end of this phase — no native blocking yet.

## Phase 3 — Native Blocker Bridge

- **Android:** a real native module — `BlockerForegroundService` + `UsageStatsManager` polling + overlay + boot persistence, all Gradle-build-verified. The Android SDK, build-tools and a JDK **are** installed on this machine; single-ABI `arm64-v8a` dev builds work. No physical device to install-and-run on.
- **Camera:** real QR scanning via `react-native-vision-camera`.
- **iOS:** a full Swift implementation (FamilyControls / ManagedSettings / DeviceActivityMonitor), JS-side tested but **never compiled** at the time (no Mac). Xcode wiring steps are in `docs/MANUAL_QA.md`.
- Apple's Family Controls entitlement application is drafted (`docs/apple-family-controls-entitlement-application.md`), not yet submitted.

## Phase 4 — Session Lifecycle Logic

Points/bonus math as pure functions; session activation + host presence intervals; `POST /sessions/:id/end` finalization; emergency-exit inline finalization; blocker-ready confirmation; the in-process session sweep worker (host migration + stale-interval reconciliation + auto-close); Screens 9/10 (Emergency Exit, Session Completion); the host-migration toast; the 30-minute offline cutoff; Screen 13 (Welcome Back) with a token-free `rejoin_session()` flow that reuses Session Details.

## Phase 5 — Gamification & Stats

The retention-strategy analysis (`docs/RETENTION_STRATEGY.md`); streaks/milestones schema + `apply_session_stats()`; both finalization paths wired; the streak-expiry job; mobile timezone/repository plumbing; the Home summary card, History, and Stats screens.

## Phase 5.5 — Push Notification Infrastructure

`device_tokens` + `users.locale`; the atomic streak-risk claim function + dispatch job; the mobile push-registration seam.

Ships fully wired and tested but **deliberately inert** — no FCM/APNs credentials exist yet. Same posture as attestation.

## Phase 6 — Hardening & B2B

Role authorization; venues (grants, ownership, create, list); static QR venue tokens + atomic join-by-venue; the B2B session-preview and metrics endpoints plus the dashboard screen; an edge-case screens pass; the device-trust-tier mechanism — built fully wired, **enforcement shipped off** pending real attestation credentials.

## Phase 6.5 — Social & Comparison Surfaces

A `users.username` column (auto-generated at signup); a mutual request/accept friend graph with atomic send/respond Postgres functions; username search; a friends-only leaderboard ranked by total lifetime points plus a coarse "active today" signal.

Deliberately **never** exposes a friend's real streak or session history.

## Phase 7 — Release Prep (2026-07-28/29)

The last backlog phase. See `backlog.md`'s Phase 7 entry for the per-task breakdown.

**Done and verified for real (not merely written):**

- helmet + rate limiting
- Account deletion (`DELETE /account`) with real cascading — this phase found and fixed a genuine gap: **most FKs had no `ON DELETE` action at all**. Plus a mobile Settings screen, the app's first.
- Placeholder ToS/Privacy served at `/legal/terms` and `/legal/privacy`, an in-app disclosure, and `users.tos_accepted_at`
- Sentry wired into both workspaces (inert pending a DSN)
- The first real color palette swept across all 17 screens — **since replaced** by Phase 8's black + navy
- Real app icons for both platforms
- Android release ABIs restored, real signing config, verified `assembleRelease`
- **Scripted** iOS project wiring (`apps/mobile/ios/scripts/wire-blocking-target.rb`, not manual Xcode GUI) that got the Swift blocker code **compiling cleanly for the first time in this project's history** via cloud macOS CI. Reached by iterating through eight real CI-caught build errors one at a time: an empty `PRODUCT_NAME`; a path-resolution bug affecting every group and file the script created; two iOS-16-only APIs used at the 15.1 deployment target; a missing `import React` for Objective-C bridge visibility; and a `Result`-vs-`Error?` completion-handler type mismatch.
- A Swift code-review finding — a >24h session would silently truncate on iOS — fixed **server-side**
- Maestro E2E flows for both golden paths (written, not yet run — no local emulator/simulator/Maestro CLI)
- A Realtime load-test script actually run locally, surfacing a real Supabase **connection-cap plan-tier limit well below the 500-connection target**
- A Dockerfile, Railway + staging-Supabase runbooks, and a staging-deploy CI workflow

**Owner-actioned, still open:** Apple Developer Program + Google Play Console enrollment is **confirmed active** (2026-07-29), but the Family Controls entitlement approval, a physical Android device, Firebase/APNs and Play Integrity/App Attest credentials, and the TestFlight/Play beta ring all remain. See `docs/MANUAL_QA.md`'s Phase 7 section.

## First-ever run — 2026-08-03

The app ran for the first time ever, on an **Android emulator** (the SDK now has platforms and system images, so Android is no longer build-only; iOS still needs a Mac).

It rendered Onboarding 1–3 → Screen 2 with working navigation — but only after fixing a startup crash the entire unit suite was structurally blind to. `@supabase/supabase-js` assigns to `url.protocol`, which React Native's built-in `URL` exposes as a **getter with no setter**, so `createClient()` threw in `App`'s first effect and nothing rendered. Fixed with `react-native-url-polyfill`, imported first in `index.js`.

The transferable lesson — **mocked SDKs cannot catch SDK-vs-platform incompatibilities; only a real device or emulator can** — is recorded as a binding convention, and should be assumed for every subsystem still marked "wired but never run".

## Phase 8 — Black + Navy Theme & Onboarding Restyle (2026-08-04)

The app is now **pure black with a navy-blue accent**, replacing Phase 7's light teal palette.

- `docs/DESIGN_GUIDELINES.md` §12 is the current, authoritative palette. `docs/NAVY_THEME_PLAN.md` is kept only as the record of *why* — the measured palette with contrast figures, the owner decisions, and 14 edge cases found by audit.
- The whole-app repaint was genuinely a **single-file change** (token *values* only) because every screen already read semantic tokens. The palette's WCAG contrast ratios are now **asserted in `tokens.test.ts`**, not merely documented.
- Screens 1–3 restyled to one visual language. Screen 1 is now a **single welcome page** — the 3-page carousel, its dots, its skip link, and the `howSessionsWork` / `whyPermissionsMatter` copy are gone from both locales. Screen 2 gained a tinted icon badge. All three use a shared `GradientButton` built on RN's built-in `experimental_backgroundImage` — no native gradient package, no icon library, no Podfile/Gradle change.
- One deliberate behaviour change, owner-decided with the cost stated: a **"maybe later" link now appears during permission *priming*, not only after a denial** — expect a lower screen-time-permission grant rate.
- `SafeAreaProvider` got its first real use; a light-content `StatusBar` landed; the iOS launch storyboard and Android window background are now black (pinned by `__tests__/native-config.test.ts` and **build-verified** by CI's `android-build` job, added in this phase precisely because nothing compiled Android before it — Jest could assert a resource file's contents but never that the project builds).

**Open follow-ups, both product calls:** the launcher icon is still teal, and the dropped onboarding copy is now explained nowhere.

## Resolved known gaps

Closed by Phase 7 planning (2026-07-28): analytics/observability (minimal Sentry-or-equivalent), ToS/privacy content (placeholder drafted for owner review), production deployment (a **PaaS, not serverless** — the in-process pollers need a long-running process), data retention (retain for account lifetime, cascade-delete on account deletion), and real FCM/APNs + Play Integrity/App Attest credentials (obtaining them was scoped in, rather than shipping v1 permanently inert).
