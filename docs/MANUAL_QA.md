# Manual QA Checklist

## Production setup — outstanding

- [ ] **Magic Link email template must include `{{ .Token }}`** — production dashboard (`LockalTime` project) → Authentication → Emails → Magic Link. The default template sends only a sign-in link, but the app's Screen 3 asks for a 6-digit code — without `{{ .Token }}` in the template body, production email sign-in dead-ends. Suggested body (mirrors `supabase/templates/magic_link.html`, which fixes this for the local stack only — local config never syncs to prod): `<h2>Your sign-in code</h2><p>Enter this code in the app to sign in:</p><h1>{{ .Token }}</h1>`. Equivalent API route: `PATCH https://api.supabase.com/v1/projects/<ref>/config/auth` with `mailer_subjects_magic_link` + `mailer_templates_magic_link_content`. Do **not** use `supabase config push` — it would sync the whole local auth config, including placeholder Google/Apple provider blocks and dev rate limits.
- Note: the schema itself is current — both migrations (`users`, signup trigger) are pushed to production and verified (2026-07-19).
- **When pushing Phase 2's session migrations to production, verify `service_role` grants land too.** Found locally (task 2.3): this Supabase CLI/platform version does not auto-expose new tables to *any* Data API role, `service_role` included — a missing `grant ... to service_role;` makes the Node API's own writes 500 with `permission denied`, even though everything else (RLS policies, `authenticated` grants) is correct. After pushing, smoke-test one real `POST /sessions` against production before considering the push done.

Items that cannot be verified on this development machine (no Mac, no physical devices) or that are inherently manual. **Updated 2026-08-03:** the Android SDK now has platforms/build-tools/system-images and a working `x86_64` emulator, so "build, install, launch, and drive the UI" is no longer blocked — only genuinely device-dependent behaviour (real app blocking, boot persistence, camera, OS permission dialogs) still is. Per `.claude/skills/testing-standards/SKILL.md`, each backlog item marked "(manual QA pending: …)" points here. Check items off when performed on real hardware; a checked backlog item with a pending entry here is implemented and JS-verified but not device-verified.

## Phase 0 — React Native app init

- [x] **Android build & launch** — **done on an emulator, 2026-08-03** (the first time this app has ever run anywhere). The old "blocked locally" note is stale: the SDK now has platforms/build-tools/system-images, and an `x86_64` AVD (`LockalTime`, Android 15) boots and runs the app. Verified: `./gradlew assembleDebug -PreactNativeArchitectures=x86_64` → `BUILD SUCCESSFUL`, `adb install` → Success, app launches and renders Onboarding 1–3 and Screen 2 (Permission Priming) with the real teal palette, tap navigation works, `E ReactNativeJS` clean. Backend reached over `adb reverse` (8081/3000/54321) — `127.0.0.1` in `config/` means the *emulator* otherwise, so the bridges are required, not optional. This run caught a real startup crash — see the URL-polyfill note in `.claude/skills/supabase-integration/SKILL.md`. Still device-only (an emulator cannot verify these): actual app blocking, boot persistence, camera QR scanning, and the permission round-trips below.
- [ ] **iOS build & launch** — `pod install` in `apps/mobile/ios`, build in Xcode, launches to Home placeholder; bundle ID shows `com.lockaltime.app`. (Blocked locally: no Mac — locked constraint in CLAUDE.md.)

## Phase 1 — i18n + RTL foundation

- [ ] **Hebrew device-language switch** — set device language to עברית, cold-start the app **twice** (`I18nManager.forceRTL` only takes effect on the next app start after the sync runs): Hebrew strings shown, layout mirrored (rows flipped, text right-aligned), no clipped/overlapping views on the Home screen.
- [ ] **Back to English** — switch device language back to English, two cold starts: layout returns to LTR, English strings shown.
- [ ] **Unsupported RTL locale** — set device language to Arabic (unsupported): app must fall back to English **in LTR layout** (the `allowRTL(isRtl)` guard — an unsupported-RTL device must not get a mirrored layout under English strings).

## Phase 1 — Onboarding welcome (Screen 1)

> Screen 1 was a three-page swipeable carousel until the black+navy theme
> pass collapsed it to a single welcome page; the RTL swipe/pagination-dot
> checks that used to live here no longer describe anything that exists.

- [ ] **RTL welcome screen on-device (Hebrew)** — with device language set to עברית (two cold starts, per the `forceRTL` note above), on a fresh install (or after clearing app storage so the onboarding-seen flag is unset): the Hebrew title and body render centred and right-to-left with no clipping, the hero ring mark stays centred, and the «מתחילים» CTA sits full-width above the home indicator. Not JS-testable: `I18nManager` is inert under Jest.

## Phase 1 — Permission priming (Screen 2)

- [ ] **Real OS permission flows — deferred to Phase 3 (native blocker bridge)** — in Phase 1 the blocking-permissions service is a pure-JS placeholder (`getStatus()` → `undetermined`, `request()` → `denied`), so pressing Allow deterministically lands on the denied fallback and no OS dialog exists to test yet. When the Phase 3 native module replaces the placeholder, verify on-device: Android — Allow launches the Usage Access and Display-over-other-apps settings intents, granting both flips `getStatus()` to `granted`, and the fallback's "Open settings" → grant → return-and-retry round-trip recovers to granted; iOS — Allow presents the FamilyControls authorization prompt (entitlement approval pending with Apple, and Mac required — locked constraint in CLAUDE.md); both — "Continue without blocking" still reaches Home with the permission ungranted, and a returning user who handled the step (either path) skips Screen 2 entirely on next cold start.

## Phase 1 — Supabase Auth wiring

- [x] **End-to-end email OTP against the local stack** — **graduated to an automated integration test**: `apps/mobile/integration/email-otp-flow.integration.test.ts` (`npm run test:integration`, also run by the CI db job) covers request → Mailpit → verify → SIGNED_IN emission → trigger-created `public.users` row. Still manual (device-only): cold-restart the app after a real sign-in and confirm the session was rehydrated from AsyncStorage (auth store authenticated without a new login).
- [ ] **Google sign-in** — blocked until real Google OAuth credentials exist and the native Google Sign-In SDK is integrated; `[auth.external.google]` currently carries a placeholder client id. Verify: native sign-in completes, `signInWithGoogle` exchanges the ID token, session lands in the auth store.
- [ ] **Apple sign-in** — blocked until real Apple credentials exist (and a Mac/device — locked constraint in CLAUDE.md); `[auth.external.apple]` carries the bundle-ID placeholder client id. Verify: Sign in with Apple completes, `signInWithApple` exchanges the identity token + nonce, session lands in the auth store.

## Phase 2 — Device attestation (Play Integrity / App Attest, monitor-mode)

- [ ] **Wire real Play Integrity (Android)** — needs a Google Play Console entry for `com.lockaltime.app` and a Google Cloud service account with the Play Integrity API enabled, used to call `playintegrity.googleapis.com` and decode the token the client's native Play Integrity SDK call produces. Until then, `apps/server/src/modules/attestation/attestation-provider.ts`'s `unconfiguredAttestationProvider` always returns `verdict: 'not_configured'` — the DB pipeline (`device_attestations` table, RLS/grants, create/join wiring) is real and integration-tested; only the verdict source is a placeholder. Replace the provider passed into `createApp` (`src/app.ts`) with a real Play Integrity adapter once credentials exist, implementing the same `AttestationProvider` interface — no call-site changes needed elsewhere.
- [ ] **Wire real App Attest (iOS)** — needs an Apple Developer Team ID and a DeviceCheck/App Attest key, used to call Apple's App Attest server API to validate the token the client's native `DCAppAttestService` call produces (also blocked on Mac access generally, per the standing iOS constraint in `CLAUDE.md`). Same placeholder/replace pattern as Android above.
- [ ] **Mobile native attestation calls** — nothing in `apps/mobile` requests a real Play Integrity/App Attest token yet (that's native module work, Phase 3+); `attestation` is an optional field in the `POST /sessions` / `POST /sessions/join` request bodies today, so create/join work identically with or without it.
- [ ] **Flip `ATTESTATION_ENFORCEMENT_ENABLED` to `true` once real credentials + monitor-mode data exist** — Phase 6 built the whole downstream mechanism (device-trust-tier schema, `points/group-bonus.ts`'s exclusion guards, `apply_session_stats()`'s streak-skip branch, `attestation/trust-tier.ts`'s `verdictToTrustTier()`/`applyEnforcementPolicy()`) fully wired and tested with the flag off — this is genuinely the only remaining step, not a separate implementation task. Before flipping it, review whether `verdictToTrustTier()`'s denylist (currently `'NONE'`/`'UNRECOGNIZED_VERDICT'`) actually matches the real Play Integrity/App Attest response shape once one exists — it was written without any real verdict data to check against.

## Phase 2 — Session screens (Screens 4–8) and two-device DoD

- [ ] **Two-physical-device create → join → live participant list** — the literal Phase 2 DoD ("two devices/simulators can create and join the same session and see each other in a live participant list"). Not run on this machine: no Android SDK platforms and no Mac (standing constraint). Verified instead via `apps/server/integration/sessions.integration.test.ts` and `apps/mobile/integration/session-channel.integration.test.ts` against the real local Supabase stack — create→join→leave, RLS, concurrent-join-at-capacity, and realtime Broadcast + Postgres Changes delivered between two independent live clients. When a device/emulator is available: install on two, Device A creates a `dynamic_qr` session, Device B enters the QR token manually (see below) on the Scan screen, both should see the other in Active Session's participant list within a couple seconds.
- [x] **Real camera QR scanning** — wired in Phase 3 task 3.5 (`react-native-vision-camera`); see the dedicated Phase 3 section below for device verification.
- [ ] **RTL layout on the five session screens** — Create/Scan/Details/Active Session were never visually checked in Hebrew/RTL on-device (same `forceRTL`-needs-a-real-device limitation as every other screen in this checklist).

## Phase 3 — Real Android blocking permissions (task 3.2)

- [ ] **Usage Access + Overlay grant round-trip on a physical device** — `BlockingPermissionsModule.kt` is real and `./gradlew assembleDebug` builds it successfully, but there's no physical Android device on this machine to install and run it on this phase. On a device: press Allow on Screen 2 → lands on the Usage Access settings screen (`ACTION_USAGE_ACCESS_SETTINGS`) → grant it → back button returns to the app → the `AppState` recheck should silently re-request, land on the Overlay settings screen (`ACTION_MANAGE_OVERLAY_PERMISSION`) next (one grant at a time — there's no combined settings screen) → grant it → return → the recheck should now report `granted` and advance to Home. Also verify: denying either grant and tapping "Open settings" behaves the same way but stays on the denied fallback.
- [ ] **Battery-optimization exemption prompt** — fires once, silently, right after a real grant; confirm the system's "Allow" dialog (`ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS`) appears and that declining it does not affect anything else (it's fire-and-forget, never gates progress).

## Phase 3 — Real Android blocking enforcement (task 3.3)

- [ ] **Actual app blocking on a physical device** — the literal Phase 3 DoD. `BlockerForegroundService.kt` is real and Gradle-build-verified, but there's no physical Android device on this machine to install and run it on. On a device, with both permissions granted: start a session with a blocked category installed (e.g. a social app), foreground that app, and confirm within ~2-4s the overlay appears and returns you to Lockal Time on tap; confirm switching to an unblocked app or back to Lockal Time itself clears the overlay; confirm killing the app from Recents does not lift the block (the foreground service should survive); confirm rebooting mid-session does not lift the block either (boot persistence, task 3.4, is real and Gradle-build-verified — see the dedicated Phase 3 boot-persistence section above for its own manual QA items).
- [ ] **UsageStatsManager polling accuracy** — verify the 2s poll interval reliably catches fast app-switches (the `POLL_INTERVAL_MS * 3` trailing window in `currentForegroundPackageName()` is a best-guess buffer, unverified on real hardware) and doesn't misfire on Lockal Time's own foreground state (`foregroundPackage != packageName` guard).
- [ ] **Foreground-service notification** — confirm it's non-dismissible while a session is active, tapping it opens the app, and it disappears when the session ends/is stopped.
- [ ] **Battery-critical event** — drain (or simulate via `adb shell dumpsys battery set level <n>`) to below the OS's low-battery threshold and confirm the app surfaces something reasonable (currently: `useAppBlocker`'s violation banner, same UI as a permission revoke).
- [ ] **`service_killed` detection** — force-stop the app process via Settings while a session is active (not just swipe from Recents) and confirm, on next foreground, the app reflects reality rather than a stuck "active" state.

## Phase 3 — Camera QR scanning (task 3.5)

- [ ] **Android: camera permission + live scan** — Gradle-build-verified with `react-native-vision-camera` linked, but never run on a real device. On a device: Scan screen should default to manual entry (undetermined permission) with an "Allow camera access" prompt; tapping it should show the real OS camera-permission dialog; once granted, the screen should switch to a live camera preview and scanning a real session QR code should navigate to Session Details with the decoded token. Confirm "Enter code manually" still works as an escape hatch from camera mode.
- [ ] **iOS: camera permission + live scan** — `NSCameraUsageDescription` added to `Info.plist`, but `pod install` and an actual build have never run (no Mac — standing constraint). Once available: same flow as Android, plus confirm the iOS permission dialog shows the `Info.plist` description text correctly.

## Phase 3 — iOS native blocker bridge (task 3.6)

Written since Phase 3, **compiled cleanly for the first time in Phase 7**
via cloud macOS CI (`.github/workflows/ci.yml`'s `ios-build` job,
`BUILD SUCCEEDED`) — reached across 10 real CI-triggered iterations, each
catching one genuine, distinct bug (see `backlog.md`'s iOS build checkbox
for the full list: an empty product name, three separate manually-
constructed-group path-resolution bugs, two iOS-16-only APIs used at this
project's 15.1 deployment target, a missing `import React`, and a
`Result`-vs-`Error?` type mismatch) — a real demonstration of using CI as
an iterative debugging feedback loop when no local device/simulator is
available, not a one-shot guess that happened to work.
`apps/mobile/ios/LockalTime/Blocking/`
(`BlockingPermissionsModule.swift`, `AppBlockerModule.swift`,
`ActivityPickerHostView.swift`, `SharedAppGroup.swift`) plus
`apps/mobile/ios/LockalTimeBlockerExtension/` (`DeviceActivityMonitorExtension.swift`,
reference `Info.plist`/`.entitlements`) exist as source files; the
one-time Xcode project wiring below (add files to targets, bridging
header, capabilities, the extension target itself) is now **scripted**
(`apps/mobile/ios/scripts/wire-blocking-target.rb`, run by CI via the
`xcodeproj` gem) rather than a manual Xcode-GUI checklist — hand-editing
`project.pbxproj` blind was the original risk this section was written to
avoid; scripting it and verifying via a real `xcodebuild` run in CI closes
that gap without ever needing to open Xcode by hand. The JS side
(`blocking-permissions.ts`, `app-blocker.ts`) is fully wired and unit-tested
against mocked native modules — nothing there changes.

CI builds unsigned, for the Simulator (`CODE_SIGNING_ALLOWED=NO`,
`-sdk iphonesimulator`) — this proves the Swift compiles and links, not
that it's ready for a signed device/App Store build. That still needs (both
owner-actioned, tracked in the Phase 7 credentials section below):

- [ ] **The real Family Controls entitlement approved by Apple** (`docs/apple-family-controls-entitlement-application.md`) — without it, `FamilyControls`/`ManagedSettings`/`DeviceActivityMonitor` API calls fail at runtime on a real device even though the code compiles.
- [ ] **A distribution certificate + provisioning profile** once the entitlement is approved and Apple Developer Program enrollment is confirmed (confirmed active as of this phase, see the Phase 7 credentials section) — needed for any signed build (TestFlight, ad hoc, or device install), not for the CI compile check above.

If `wire-blocking-target.rb` needs a real Xcode-GUI touch-up (e.g. the
`xcodeproj` gem produced something Xcode itself would reformat/re-resolve
differently), the original manual steps it replaces were: add the
Blocking/ files to the LockalTime target with the bridging header pointed
at the existing `.h` file; add `en.lproj`/`he.lproj` `Localizable.strings`
as one variant group; add App Groups (`group.com.lockaltime.app`) +
Family Controls capabilities to LockalTime, entitlements file already
written; create a "Device Activity Monitor Extension" target named
`LockalTimeBlockerExtension`, delete Xcode's generated starter files, add
the already-written `DeviceActivityMonitorExtension.swift`/`Info.plist`
instead; give the extension the same App Group + Family Controls,
entitlements file already written; share `SharedAppGroup.swift` across
both targets (one file, two target memberships, never duplicated).

### Functional verification (after the above, on a real device with the Family Controls entitlement approved)

- [ ] **FamilyControls authorization + category picker** — press Allow on Screen 2 → real "Screen Time" authorization dialog → on approval, `FamilyActivityPicker` should present (`ActivityPickerHostView`) with Cancel/Done in the localized (en/he) title; picking at least one category and tapping Done should return to the app with the permission flow completing (`getStatus()` → `granted`); Cancel or Done-with-nothing-selected should both leave it `denied`.
- [ ] **Shield applies and blocks in real time** — start a session; foreground an app in a selected category and confirm Apple's system Shield UI appears (this is Apple's own shield screen, not a custom Lockal Time overlay — different UX from Android's overlay by design, both platforms' native conventions).
- [ ] **DeviceActivityMonitorExtension survives app suspension** — start a session, force-quit LockalTime from the App Switcher, wait past the session's `endsAt`, and confirm the shield clears anyway (this is the entire reason the extension exists — verify it actually does what ARCHITECTURE.md §4 claims).
- [ ] **App Group data sharing** — confirm a `FamilyActivitySelection` saved by the main app's picker flow is correctly read back by the extension when its interval starts (would show as: apps outside the picked categories are never shielded, even though the extension runs in a separate process and never talked to the main app directly).
- [ ] **Code review before any of the above** — this Swift was written without a compiler catching mistakes; a careful read-through (especially `AppBlockerModule.scheduleMonitoring`'s time-of-day-based `DeviceActivitySchedule`, and the midnight-spanning-session edge case noted in its comment) is warranted before spending real device-testing time on it.

## Phase 3 — Boot persistence (task 3.4)

- [ ] **Reboot mid-session restarts blocking** — start a session, then reboot the device (not just force-stop the app) without stopping the session first. After the device finishes booting and is unlocked, confirm the Foreground Service notification reappears and blocking resumes without opening the app. `BootPersistence`/`BootCompletedReceiver` are Gradle-build-verified but never run on a real device this phase.
- [ ] **A cleanly-ended session does NOT resume after reboot** — stop a session normally (or let a fixed-duration one reach `endsAt`), then reboot. Confirm nothing restarts — the persisted snapshot should have been cleared.
- [ ] **A fixed-duration session whose `endsAt` passed while the device was off does NOT resume** — start a short fixed session, power off the device before it ends, wait past `endsAt`, power back on. Confirm blocking does not restart (and the stale snapshot gets cleared on that boot).
- [ ] **Direct-boot limitation** — this only listens for `BOOT_COMPLETED` (after the user unlocks), not `LOCKED_BOOT_COMPLETED` — `EncryptedSharedPreferences` needs credential-encrypted storage, unavailable before first unlock. A session active across a reboot won't resume enforcement until the user actually unlocks the device once; document this as an accepted limitation if it matters in practice.

## Phase 4 — Offline 30-minute native-enforced cutoff (task 11)

- [ ] **Android: real cutoff timing** — `BlockerForegroundService.kt` checks `ConnectivityManager` every poll cycle (2s) and self-stops (lifting the block, clearing boot-persistence, emitting `offline_cutoff_reached`) once 30 continuous minutes have passed without an active internet-capable network. Gradle-build-verified, never run on a real device this phase. On a device: start a session, enable Airplane Mode, wait ~30 minutes (or temporarily lower `OFFLINE_CUTOFF_MS` for a faster manual check, then revert), and confirm the overlay/foreground-service notification clear on their own and the app reflects `degraded_offline` on next foreground. Also confirm re-enabling connectivity *before* the 30 minutes elapse does **not** trigger a false cutoff (the poll loop should just resume normal enforcement).
- [ ] **iOS: real cutoff timing, and the accepted background-execution gap** — `AppBlockerModule.swift` uses `NWPathMonitor` + a repeating `Timer` to track offline duration, but (documented in the file's own header comment, a genuine platform difference from Android, not an oversight) this only runs while the module's process is alive — iOS has no equivalent to Android's always-on foreground service available to this feature, so a *fully suspended* app will not detect an offline cutoff the way Android's foreground service does. Never compiled (no Mac). Once available: verify the timing works while the app is foregrounded/briefly backgrounded, and separately confirm (and accept, for now) that a fully suspended app does not enforce the cutoff — this is a known gap, not a bug to "fix" without first deciding whether a background network extension is worth the added complexity.
- [ ] **JS: CONNECTION_LOST / RECONNECTED via realtime socket health** — separate from the native cutoff above: `session-channel.ts`'s `channel.subscribe()` status callback now drives `use-session.ts`'s `CONNECTION_LOST`/`RECONNECTED` machine events (unit-tested with a mocked channel). On a device: toggle Airplane Mode briefly during an active session and confirm the UI reflects `participant_reconnecting`, then returns to `active` once connectivity and the realtime socket recover — this is a much shorter, client-observed signal than the native 30-minute cutoff, and the two are expected to disagree in the short term (a brief realtime drop with the native layer still well within its 30-minute grace).

## Phase 1 — Auth error states (Screen 3)

- [ ] **Account-linking dialog against a real identity collision** — unproducible locally: placeholder provider credentials mean no real Google/Apple sign-in can collide with an existing email account. When real credentials land: sign up with email, then sign in with Google using the same address, and verify GoTrue returns one of the mapped collision codes (`email_exists` / `user_already_exists` / `identity_already_exists` — the `provider_email_conflict` mapping in `auth-service.ts` covers all three because the exact live code is unverified) and the calm account-linking dialog opens with a working "Sign in with email" path. Wrong-OTP and network-failure error states are fully covered by the unit suites and need no manual pass.

## Phase 6 — Hardening & B2B

Everything below is implemented, unit-tested, and proven against the live local Supabase stack via real integration tests (224 server unit tests, 154 pgTAP assertions, 17 integration tests, 618 mobile unit tests) — these items are purely "does it also look/feel right on a real device," not open implementation work.

- [ ] **Scan a real printed venue QR code** — create a verified-host venue (`VenueManagementScreen`), print or display its code, and scan it from a second device's camera (`ScanSessionScreen`, wired since Phase 3). Confirm Session Details shows the venue name and real participant count (via the preview endpoint) before joining, and that joining lands correctly on the venue's currently-active `static_qr` session — proven server-side by `apps/server/integration/venues.integration.test.ts`, never exercised through the actual camera/QR-rendering path on this machine.
- [ ] **B2B dashboard on real hardware** — `VenueDashboardScreen`'s two stat tiles and venue picker (for a host with more than one venue), confirming layout/touch targets feel right at `DESIGN_GUIDELINES` sizing on an actual screen, not just RNTL's virtual layout.
- [ ] **RTL (Hebrew) pass on every screen this phase added or rebuilt** — `VenueManagementScreen`, `VenueDashboardScreen`, the rebuilt `SessionDetailsScreen` (preview details + per-code recovery affordance), and `ActiveSessionScreen`'s new offline banner. All pass the existing i18n-parity/RTL-safe-layout conventions at the code level (logical properties only, no hardcoded `left`/`right`); this is the same "on-device RTL paging/layout" gap every prior phase's screens carry (`I18nManager.forceRTL` only takes effect on next app start, not JS-testable).
- [ ] **Regenerate a venue's QR code on a device the old printout is displayed on** — confirm the old printed/displayed code visibly stops working (shows the "no session running" or invalid-token recovery state) immediately after regeneration, not just via the integration test's assertion.

## Phase 5.5 — Push Notification Infrastructure

Everything below is implemented, unit-tested, and proven against the live local Supabase stack via real integration tests (240 server unit tests, 175 pgTAP assertions, 21 integration tests, 631 mobile unit tests) — the claim logic, dispatch composition, and localized copy selection are all real and proven end-to-end today. What's outstanding is entirely credentials and native SDK linking, not implementation work — the pipeline ships deliberately inert until these exist, same posture as Play Integrity/App Attest (Phase 2/6).

- [ ] **Firebase project + FCM credentials (Android)** — create a Firebase project for `com.lockaltime.app`, obtain a service account, and write a real `NotificationSender` adapter against FCM's HTTP v1 API (replacing `unconfiguredNotificationSender`, `apps/server/src/modules/notifications/notification-sender.ts`).
- [ ] **Apple Push key/cert (iOS)** — obtain an APNs auth key from the Apple Developer account (the same account `docs/apple-family-controls-entitlement-application.md` is waiting on), and extend the same adapter for APNs.
- [ ] **Link a real native push SDK on both platforms** (`@react-native-firebase/messaging` or equivalent) and replace `pushRegistration`'s placeholder (`apps/mobile/src/services/push-registration.ts`) with real token acquisition — currently deterministically reports `'unavailable'`, so `registerPushTokenIfChanged()` never actually writes a `device_tokens` row on a real device yet.
- [ ] **An actual on-device push receipt** — once both adapters above exist, let a real streak sit within the 6-hour window and confirm the device actually receives the notification, in both English and Hebrew (the locale is read from `users.locale`, reported by `reportLocaleIfChanged()`).

## Phase 7 — Release Prep credentials & beta ring

Confirmed with the owner during this phase (2026-07-29): **Apple Developer
Program and Google Play Console enrollment are both already active** —
this unblocks the iOS/Android/store-listing tracks below procedurally, but
the actual portal actions (certificates, listing content, submission) are
still owner-actioned since this environment has no login to either.
**Not yet set up**: a PaaS account (Railway), a Sentry account, and
Firebase/APNs credentials — all built fully wired this phase and left
inert per the items below, same posture as Play Integrity/App Attest.

- [ ] **Physical Android device availability** — still unconfirmed as of this
  phase. This blocks nearly every Phase 3 native-enforcement item above
  (actual blocking, boot persistence, permission round-trips) — it is a
  release-blocking prerequisite per the Phase 7 DoD, not optional polish.
  Confirm status and, once available, work through every unchecked Phase 3
  item above before a public submission.
- [ ] **Sentry account + project** — create one at sentry.io (a React Native
  + Node project, or two separate projects). Set the resulting DSN as:
  - Server: `SENTRY_DSN` env var (Railway → Settings → Variables; see
    `docs/DEPLOYMENT.md`).
  - Mobile: edit `apps/mobile/src/config/monitoring-config.ts`'s
    `SENTRY_DSN` constant directly (no build-time env-injection exists yet
    for the mobile app — same "hardcoded pending real per-environment
    config" status as `supabase-config.ts`).
  Once set, trigger a real error in each (e.g. a deliberately-thrown error
  behind a debug-only button) and confirm it appears in the Sentry
  dashboard within a minute or two.
- [ ] **Sentry native build-time plugins (source maps / dSYMs)** — NOT
  wired this phase (needs a real Sentry auth token to configure the
  Android Gradle plugin / Xcode build phase for source-map and debug-symbol
  upload). Without this, crash reports still arrive but stack traces show
  minified/obfuscated frames instead of real file/line — follow Sentry's
  own React Native wizard (`npx @sentry/wizard@latest -i reactNative`) once
  the account exists; it edits the native project files directly.
- [ ] **Railway account** — create at railway.app, connect this repo, set
  the env vars `docs/DEPLOYMENT.md`'s "Production API hosting" section
  lists, and deploy. Confirm `GET /health` responds and the server logs
  show the sweep/streak-expiry/streak-risk-notification pollers ticking
  (they log a warning only on failure, per `server.ts` — silence on that
  cadence is the healthy state).
- [ ] **Staging Supabase project (`LockalTime-staging`)** — see
  `docs/DEPLOYMENT.md`'s "Staging Supabase project" section for the exact
  commands; confirm `scripts/verify-service-role-grants.sql` reports zero
  missing grants before considering it done.
- [ ] **TestFlight + Play internal testing beta ring** — once a signed iOS
  build (real Family Controls entitlement + distribution cert/profile) and
  a signed Android release build both exist: upload to App Store Connect
  (TestFlight) and Google Play Console (internal testing track), invite a
  small group of real testers on real hardware, and work through every
  outstanding item in this checklist against their actual devices before
  any public submission — this is what actually closes this document's
  "no physical device"/"no Mac" gaps, not further JS-side work.

## Black + navy theme (whole-app dark repaint, onboarding restyle)

Everything below is device-only: the palette, the gradient and the two
pre-mount launch surfaces are all things a Jest assertion can pin the
*values* of but never actually look at.

- [ ] **Cold-start launch surfaces, both platforms** — the whole point of the
  two native changes below is a launch with **no white flash**. Android:
  `android/app/src/main/res/values/styles.xml` now sets
  `android:windowBackground=@color/window_background` (black) and
  `android:windowLightStatusBar=false`; verify the window is black from the
  instant the icon is tapped, and that the status-bar clock/battery are
  **visible** (light icons) on every screen. iOS:
  `ios/LockalTime/LaunchScreen.storyboard` is now black with white labels;
  verify the same. The Android side **is now compiled in CI** (the
  `android-build` job runs `assembleDebug`), so a broken
  `@color/window_background` reference fails the build rather than reaching a
  device — what remains device-only is whether the launch actually *looks*
  right, which no build can tell you.
- [ ] **The two launch surfaces stay in sync with `colors.background`** — they
  are hardcoded black in native resource files and cannot read the JS token.
  If the palette's background ever changes, both must be changed by hand
  (`__tests__/native-config.test.ts` pins that they are black, not that they
  match the token).
- [ ] **CTA gradient under RTL (Hebrew)** — the onboarding CTA is a
  left-to-right navy gradient, and it does **not** mirror under RTL: a
  gradient is a paint instruction, not layout, so React Native will not flip
  it, and branching a style on locale is forbidden. Look at it in Hebrew and
  judge whether the fixed direction reads wrong. If it does, that is a
  product decision to bring back, not a bug to patch locally.
- [ ] **Gradient renders at all** — it uses RN's `experimental_backgroundImage`
  (built-in CSS gradients, new architecture). Verified in JS only as "the
  style object is declared correctly"; that the GPU actually paints a
  gradient rather than a flat or transparent fill is device-only. Check on
  both platforms.
- [ ] **Small screen + large OS font** — on a ~320×568pt device with the OS
  text size turned up, Screen 1's stack (hero, title, body, CTA) must still
  fit with the CTA fully visible and tappable. The hero is capped against
  window height for exactly this reason; confirm it actually shrinks rather
  than pushing the CTA off-screen, and that it stays a circle.
- [ ] **Every screen re-checked against a black background** — all 17 screens
  were repainted by changing token *values* only, with no per-screen edits.
  The one inverted assumption found by audit (the Auth account-linking
  dialog, which was filled with `background` and became invisible over a
  black scrimmed page) is fixed and pinned by a test, but only a real
  look-through will find any remaining case where something was legible on
  white by accident. Pay attention to: disabled/placeholder states, camera
  viewfinder letterboxing, and anything drawn as a hairline border.
- [ ] **App icon is still teal** — the launcher icon is a white ring on teal
  `#0F6B5C`, which no longer matches the black-and-navy app behind it. The
  owner chose to keep the logo as-is for now; raise redesigning it as a
  follow-up.
