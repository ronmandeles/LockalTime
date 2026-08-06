---
name: platform-constraints
description: What can and cannot actually be verified on this machine — no Mac, Android emulator only, and the list of SDKs that are wired but never run. Read before any task touching native modules, iOS, push, attestation, or a third-party SDK.
---

This project is developed on a Windows PC. Several subsystems are **written and unit-tested but have never executed against the real platform**. Knowing which is which prevents both false confidence and wasted effort.

## The core lesson

> **Mocked SDKs cannot catch SDK-vs-platform incompatibilities. Only a real device or emulator can.**

Earned the hard way: the app rendered nothing on its first-ever launch (2026-08-03) because `@supabase/supabase-js` assigns to `url.protocol`, which React Native's built-in `URL` exposes as a **getter with no setter**. `createClient()` threw inside `App`'s first effect. The entire unit suite was structurally blind to it — every test mocked the SDK. Fixed with `react-native-url-polyfill`, imported first in `index.js`.

**Assume the same class of failure is latent in every subsystem below marked "never run".** When one of them first meets a device, budget for it and check the real runtime surface, not the mock.

## Verification status

| Subsystem | Status |
|---|---|
| `apps/server` (Node API) | Fully runnable and tested locally, incl. real integration tests against local Supabase |
| Supabase (Postgres/RLS/Realtime) | Fully runnable locally; pgTAP + real integration tests |
| Android build | **Real** — SDK, build-tools, JDK installed. `assembleDebug`/`assembleRelease` verified; CI `android-build` job compiles it |
| Android runtime | Emulator only (first run 2026-08-03). **No physical device** |
| iOS build | Compiles via **cloud macOS CI** only (`ci.yml`'s `ios-build`). **No Mac on this machine** |
| iOS runtime | Never run anywhere — no simulator, no device |
| Native blocker (Android/iOS) | Compiles on both. Runtime behaviour unverified |
| Camera QR (`react-native-vision-camera`) | Linked and building; never run |
| Push (FCM/APNs) | Fully wired and tested, deliberately **inert** — no credentials exist |
| Attestation (Play Integrity / App Attest) | Fully wired, monitor-mode, **inert** — no credentials exist |
| Maestro E2E flows | Written, **never run** — no local emulator-driven Maestro CLI |
| Sentry | Wired in both workspaces, inert pending a DSN |

## Rules

- **iOS code is authored blind and verified by JS-side contract tests.** Compiling, running, and device-testing iOS is marked "manual QA pending (Mac required)" and **never blocks a phase**.
- Never hand-edit `project.pbxproj`. iOS project wiring is scripted: `apps/mobile/ios/scripts/wire-blocking-target.rb`, exercised by CI. Extend the script; don't click through Xcode.
- iOS deployment target is **15.1** — iOS 16+ APIs are a build error, caught only by cloud CI. Check availability before using a Screen Time / SwiftUI API.
- Anything not verifiable on this machine goes in `docs/MANUAL_QA.md` in the same turn, with the exact steps to run once the hardware or credential exists.
- Inert-by-design subsystems (push, attestation) ship fully wired behind a placeholder provider that fails **open**, never blocking a user action. Keep that posture when extending them.
- A Jest test can assert a native resource file's *contents*; only a build job proves the project *compiles*. When you change native config, make sure a CI build job covers it.

## Owner-actioned, still open

Apple Developer Program and Google Play Console are **active** (2026-07-29). Still outstanding: Family Controls entitlement approval, a physical Android device, Firebase/APNs credentials, Play Integrity/App Attest credentials, and the TestFlight/Play beta ring. See `docs/MANUAL_QA.md`.
