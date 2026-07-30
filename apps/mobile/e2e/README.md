# E2E (Maestro) — Phase 7 Release Prep

Golden-path flows for the app's two most important user journeys, per
`backlog.md`'s Phase 7 quality-gates entry: **create → join → complete**
and **create → emergency exit**. Maestro, not Detox — a locked decision
(`CLAUDE.md`).

**Status: written, not yet executed.** This machine has no Android
emulator (GPU can't run one — the standing constraint noted throughout
`docs/MANUAL_QA.md`), no iOS Simulator (no Mac), and no Maestro CLI
installed (it isn't distributed for native Windows). These flows are real,
reviewed YAML built against this codebase's actual `testID`s — the same
posture as the iOS Swift code before Phase 7's macOS CI job: a strong,
specific first draft, not something that has run and passed. Run and fix
on a real device/CI runner before trusting them as a release gate.

## Prerequisites to actually run these

1. [Maestro CLI](https://maestro.mobile.dev) installed (macOS/Linux, or
   inside the same cloud runner CI uses for the iOS build).
2. The app built and installed on a connected Android emulator/device or
   iOS Simulator, pointed at a real backend — local Supabase + `apps/server`
   running (`npx supabase start`, `npm run dev --workspace apps/server`),
   or the staging deployment (`docs/DEPLOYMENT.md`) per the backlog item's
   "run in CI against the new staging deployment."
3. Node (for `scripts/fetch-otp.js`, which reads the real email-OTP code
   from Mailpit's HTTP API — see its header comment; this only works
   against local/staging, exactly like the retention rule already used
   everywhere else in this repo: E2E/load tests never target production).

Then: `./run.sh android` or `./run.sh ios`.

## What these flows cover

- **`01`–`04`** (create → join → complete): a host account creates a
  1-minute `dynamic_qr` session, the QR token is copied to the OS
  clipboard, the host's own session rides out to completion and signs out,
  then a second test account signs in and joins via ScanSessionScreen's
  **"enter code manually"** path (pasting the copied token) — not actual
  camera QR scanning, which Maestro has no reliable way to drive against a
  rendered code on a second physical device. This is a genuine exercise of
  the real join *logic* end-to-end, executed on **one device with two
  sequential accounts** rather than two physical devices.
- **`10`–`11`** (create → emergency exit): a single account creates a
  30-minute solo session, then exercises the real hold-to-confirm
  interaction (`EmergencyExitScreen.tsx`, `HOLD_DURATION_MS`) via Maestro's
  `longPressOn`, and asserts the completion screen reflects the
  forfeited-bonus outcome.

## What these flows deliberately do NOT cover

- **A true two-physical-device join** (Device A creates, Device B scans a
  real rendered QR code with its real camera) — still tracked as manual QA
  in `docs/MANUAL_QA.md`'s "Two-physical-device create → join → live
  participant list" item. Maestro doesn't orchestrate two independent
  device sessions with a shared clipboard the way this same-device
  stand-in does.
- Google/Apple sign-in (native OAuth sheets aren't reliably automatable
  the same way across both platforms, and both are still "manual QA
  pending" per `docs/MANUAL_QA.md` regardless).
- Real native blocking enforcement (shield/overlay actually appearing) —
  that's the physical-device manual QA this whole project has tracked
  since Phase 3; Maestro drives the app's own screens, not the OS-level
  blocking UI another app would show.

## Known open question for whoever runs these first

`longPressOn`'s default press duration needs to exceed
`EmergencyExitScreen.tsx`'s `HOLD_DURATION_MS` (1500ms) for `11` to
actually trigger the exit rather than release too early — pass an explicit
`duration` if the installed Maestro version's syntax supports it (see that
flow file's own comment).
