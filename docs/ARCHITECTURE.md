# Lockal Time — Architecture

Status: planning blueprint, pre-implementation. This document is the single source of truth for system design decisions. Update it whenever a decision changes or a new service/data structure is added — do not let it drift from reality.

## 1. Product Summary

Social, location/time/group-based distraction-blocking app. Core value: shared, enforced presence without digital distraction, motivated through restrained gamification rather than compulsive engagement loops. Native iOS + Android, React Native, Node.js business-logic API, Supabase (Postgres/Auth/Realtime).

Design/product philosophy: **reward consistency and completion, never reward randomness or comparison.** No leaderboards, no variable/surprise rewards, no badge overload. Streaks and milestones only, both with generous grace/periodicity so they build habit without inducing anxiety.

> ⚠️ **Product direction under active revision (owner decision, 2026-07).** The owner wants Lockal Time to be deliberately **engaging / high-retention** ("addictive") on the theory that the more a user is hooked on *this* app, the less they use their phone overall — so retention is treated as aligned with the mission, not opposed to it, and it's a selling point. This **reverses** the restrained-engagement stance stated in this section and in §9. It does **not** yet decide any specific mechanic: the next step is an explicit analysis of the retention/"addiction" techniques used by large consumer apps (variable rewards, streak pressure, notifications, social proof, etc.), rethought to fit the less-phone-use goal, after which the adopted mechanics get written into §1/§9 and the DoDs. Until that analysis is agreed, the text below still stands as the current spec — but new gamification/engagement work must flag this pivot and not treat the "avoid" list as final. Tracked in `backlog.md` and CLAUDE.md.

## 2. Screens & Flow

1. Onboarding (permission priming)
2. Permission approval (OS-level: Usage Access / Overlay on Android, FamilyControls on iOS)
3. Auth (Google / Apple / email)
4. Home
5. Create Session (mode: `solo` | `dynamic_qr` | `static_qr`; duration: fixed X minutes/hours, or open-ended "until I close it")
6. Active Session (host/manager view — countdown or open-ended elapsed timer, live participant list, emergency exit)
7. QR Scan (join)
8. Session Details (pre-join confirmation; also reused for rejoin after a disconnect)
9. Emergency Exit (participant-initiated, forfeits bonuses, confirmation required — long-press/slide, not a tap)
10. Session Completion (points receipt, bonuses broken out separately)
11. History (filter: Solo / Group / All)
12. Stats (7-day chart, lifetime aggregates)
13. **Welcome Back / Session Interrupted** *(new)* — shown on relaunch after an involuntary disconnect. Shows points earned so far. If the session is still open: "Rejoin Session" → Session Details screen directly (no QR re-scan, we already know the `session_id`). If the session ended while disconnected: routes to the normal Completion screen instead.

Known edge-case screens still needed but not yet designed (tracked in backlog): permission-denied fallback, QR expired/invalid/at-capacity, host-migration toast (new host only, small + calm, few seconds), account-linking dialog (OAuth email collision), offline/connectivity-lost banner.

**Implemented Phase 2 task 2.7** (skeleton — no native blocking, sessions are "virtual"): Screens 4–8 all real navigator routes (`apps/mobile/src/navigation/types.ts`). Screen 7's QR Scan was manual token entry only in Phase 2 (no camera dependency); the actual `POST /sessions/join` call happens on Screen 8 (pre-join confirmation), not Screen 7, so a bad/expired/full code surfaces its specific error where the user can act on it. The edge-case screens listed above (QR expired/invalid/at-capacity) are *not* separate screens — they're error states rendered inline on Screen 8, keyed off the join outcome's failure code. **Implemented Phase 3 task 3.5:** Screen 7 now defaults to a real camera scan (`react-native-vision-camera` — pinned to the stable `^4.0.0` line, not the newer Nitro-Modules-based `5.x`) once permission is granted, with manual entry always one tap away; a scanned code and a typed one both still resolve on Screen 8, unchanged.

**Implemented Phase 4 tasks 8/9:** Screen 10 (`SessionCompletionScreen.tsx`) reads the already-finalized `session_participants`/`rewards_history` rows and renders the receipt, reached from either a normal session end or a successful Emergency Exit — both write the same shape, so the screen only branches on `exit_reason`. Screen 9 (`EmergencyExitScreen.tsx`) is reached via a subdued link on Active Session, shown only while the session is genuinely ongoing; confirmation is a 1500ms hold (a plain timer driving a state-toggled style, not `Animated.timing` — see backlog.md task 8 for why), and a successful exit resets navigation into Screen 10.

## 3. Tech Stack & Service Boundaries

| Layer | Responsibility | Rule |
|---|---|---|
| React Native app (bare workflow, **React Navigation**, **Zustand** for general app state, **XState** for session lifecycle) | UI, native module bridging, local blocker state | Never authoritative for points, QR validity, or session state — always defers to server on reconnect |
| Node.js API (**Express**, TypeScript) | Session lifecycle, QR signing/validation, points/bonus calculation, host migration worker, device attestation checks | The **only** place money-equivalent logic (points, bonuses, QR tokens) is computed or minted. Client claims of "I completed X" are never trusted. Express chosen over NestJS: our API surface is small and well-bounded (~4-5 modules), and this is a solo/small-team build where NestJS's enforced-structure benefit (paying off with many contributors) doesn't outweigh its added ceremony per atomic task. **Auth boundary** (Phase 2 task 2.0, `.claude/skills/api-design/SKILL.md`): the mobile app's Supabase access token is sent as `Authorization: Bearer <token>`; the server verifies its signature against Supabase's JWKS (`jose`'s `createRemoteJWKSet`, ES256 — the local stack's and current Supabase default; the public key is fetched once and cached, so this stays a no-round-trip check after the first request) and never trusts a client-supplied user id. **Validation:** zod schemas at each route boundary. **Errors:** every failure renders through one JSON envelope, `{ error: { code, message } }` — `code` is the real contract the mobile app switches on; `message` is diagnostic-only. |
| Supabase (Postgres) | Source of truth for all persisted state | RLS-protected; direct client reads allowed for read-only aggregates (home summary, history, stats), never for writes that affect points |
| Supabase Realtime | Live sync between clients | See §5 — Presence/Broadcast are UI-hints only; Postgres Changes (CDC) is the only trusted channel for state that affects points |

## 4. Native Blocking Modules

### Blocking policy scope
A session blocks a **fixed set of default categories** (e.g., Social Networking, Games, Entertainment) — not a per-session or per-user app picker. Neither platform requires us to maintain our own app-to-category database:
- **iOS:** `FamilyControls`/`ManagedSettings` can restrict at the category level via `ActivityCategoryToken`, based on each app's own App Store category — we never need to know which specific apps a user has installed.
- **Android:** apps declare a category via `ApplicationInfo.category` (`CATEGORY_SOCIAL`, `CATEGORY_GAME`, etc.), queryable via `PackageManager` at runtime; we filter installed apps by category at block-time.
- **Known limitation:** Android's category field is inconsistently populated by developers (some apps are `CATEGORY_UNDEFINED`), so category-based blocking may miss a small number of mislabeled apps. Accepted limitation, not solved for MVP.
- No new `sessions` schema needed for this — it's a fixed Node/native config constant (the blocked-category list), not user- or session-configurable data.

### Android
- **Mechanism: `UsageStatsManager` polling + `SYSTEM_ALERT_WINDOW` overlay + Foreground Service.** Deliberately **not** using `AccessibilityService`: Google Play tightened AccessibilityService policy with enforcement from Jan 28, 2026 — non-accessibility uses require a Play Console declaration, mandatory in-app disclosure + affirmative consent, and a stricter review process, with no exemption available to us (`isAccessibilityTool=true` is reserved for genuine disability-accessibility tools). UsageStats + Overlay avoids that review gate entirely, at the cost of ~1-2s polling lag instead of instant event detection — acceptable for this use case.
- **Boot persistence:** `BroadcastReceiver` on `BOOT_COMPLETED` checks locally-persisted session state (encrypted storage, not just Supabase — device may boot offline) and restarts the Foreground Service if a session was mid-flight at reboot.
- **Implemented Phase 3 task 3.3** (`apps/mobile/android/app/src/main/java/com/lockaltime/blocking/`): `BlockerForegroundService.kt` polls every 2s, self-detects a mid-session Usage Access/Overlay revoke (§8 item 2 — emits `permission_revoked` rather than crashing), and self-stops once the session's `endsAt` passes (a local UX safeguard only, never the server-authoritative end reason — Money-Equivalent Logic Rule). `AppBlockerModule.kt` is the JS bridge (start/stop/getStatus); events relay in-process via `RCTDeviceEventEmitter` since the service and RN instance share one process — no IPC needed. Requires `foregroundServiceType="specialUse"` + a declared subtype reason on Android 14+ (re-verify against whatever OS version is current by ship time). One correction from this doc's original wording: Android has no distinct "Entertainment" `ApplicationInfo` category, so that JS category maps to `CATEGORY_VIDEO` + `CATEGORY_AUDIO` as the closest fit — folded into the "known limitation" note above, not a separate gap. Gradle-build-verified; no physical device this phase, so on-device polling/overlay timing is manual QA pending (`docs/MANUAL_QA.md`).
- **Implemented Phase 3 task 3.4:** `BootPersistence.kt` (`androidx.security:security-crypto`, `EncryptedSharedPreferences`) saves a snapshot on every real service start and clears it on any *deliberate* stop (JS `stop()` or task 3.3's local endsAt-reached self-stop); `BootCompletedReceiver.kt` reads it on `BOOT_COMPLETED`, skipping (and clearing) a session whose `endsAt` already passed while the device was off. One accepted limitation: only listens for `BOOT_COMPLETED` (post-unlock), not `LOCKED_BOOT_COMPLETED` — `EncryptedSharedPreferences` needs credential-encrypted storage, unavailable before first unlock, so enforcement doesn't resume until the user unlocks once. Gradle-build-verified; never run on a real device this phase.
- **Known unfixable gap:** Android Safe Mode disables all 3rd-party apps including ours. No technical fix exists; accepted as a documented limitation, mitigated only by server-side heartbeat-gap reconciliation after the fact (see §8 threat model).

### iOS
- **Mechanism:** `FamilyControls` (authorization, requested at Screen 2) + `ManagedSettings` (Shield applied at session start) + `DeviceActivityMonitor` extension (enforces for the session's planned duration).
- **Critical constraint:** the `DeviceActivityMonitor` extension runs as a **separate OS process**, independent of the main app's lifecycle — it cannot call back into React Native directly. Communication goes through a **shared App Group container** (shared UserDefaults/file) or **Darwin notifications**, observed by the main app when foregrounded. The extension itself — not the JS layer — is responsible for clearing the shield at session end; JS only reconciles what already happened.
- **Entitlement status:** Family Controls / Screen Time API entitlement application in progress with Apple (real lead time, no guaranteed approval). Development proceeds in parallel as if approved; the native module is built and tested via TestFlight/internal builds, with the understanding that App Store submission is blocked until entitlement approval lands.
- **Implemented Phase 3 task 3.6** (`apps/mobile/ios/LockalTime/Blocking/`): `BlockingPermissionsModule.swift` requests FamilyControls authorization, then — a design nuance discovered only while implementing this, not previously scoped — presents `FamilyActivityPicker` (`ActivityPickerHostView.swift`, SwiftUI) so the user picks which categories to block. This is required, not optional: Screen Time API `ActivityCategoryToken`s are opaque and privacy-preserving by design — the app can never construct a token for "Social Networking" out of thin air, only capture whichever categories the user selects via Apple's own picker UI, once, and reapply that same saved selection on every session start (`SharedAppGroup.swift`, `Codable`-persisted). `AppBlockerModule.swift` applies the shield immediately via `ManagedSettingsStore` and schedules `DeviceActivityCenter` monitoring so the `DeviceActivityMonitorExtension` (separate process, `apps/mobile/ios/LockalTimeBlockerExtension/`) guarantees shield cleanup at session end even if the main app is suspended. **Not compiled or run anywhere in this repo** (no Mac) — written to match these frameworks' documented APIs as precisely as possible, but genuinely unverified; the JS-side wiring (`blocking-permissions.ts`/`app-blocker.ts`) IS tested (mocked native modules), since that part doesn't depend on Swift actually compiling. The extension needs a real Xcode target that isn't wired into `project.pbxproj` in this change (deliberate — see `docs/MANUAL_QA.md`'s "iOS extension target setup" for the full manual steps once a Mac is available).

### Bridge pattern (both platforms)
Native Module exposes `start(sessionConfig) / stop() / getStatus()`, plus a JS `EventEmitter` for native-observed events (`shield_triggered`, `service_killed`, `battery_critical`, `permission_revoked`). A `useAppBlocker` hook subscribes and reconciles against the Supabase session record — e.g., if native reports the service was killed and the app relaunches mid-session, the hook surfaces Screen 13 (Welcome Back) rather than leaving a zombie session.

### Offline mode
The 30-minute offline enforcement window (PRD requirement) is owned by the **native layer**, not JS — JS/React Native can be suspended by the OS while the native foreground service/extension keeps running. The native side self-enforces the cutoff and emits an event; JS only surfaces the resulting state when it wakes.

## 5. Realtime Architecture

Per-session channel `session:{session_id}`, using three Supabase Realtime primitives together:

1. **Presence** — each client tracks itself (`user_id`, `is_host`, `joined_at`), heartbeat ~15s. This is what host-liveness detection rides on; no persisted heartbeat table needed.
2. **Broadcast** — ephemeral events with no persistence need: timer ticks, `host_migrated`, `session_ended`, participant join/leave UI pulses. **UI-hint only — never trusted for anything that affects points.**
3. **Postgres Changes (CDC)** — durable state (`session_participants`, `session_presence_intervals` inserts/updates), so a reconnecting client gets consistent state via an initial REST fetch + resumed CDC stream rather than trusting only in-memory Broadcast events it may have missed.

**Implemented Phase 2 task 2.5:** `apps/mobile/src/services/session-channel.ts`. One correction found via a real integration test against the local stack rather than assumed: Postgres Changes enforces RLS on the *subscribing* connection, same as any REST read — an unauthenticated (anon-role) client silently receives no CDC events at all, even for a table it could otherwise query once signed in. Every real subscriber must carry an authenticated session.

## 6. Session Lifecycle & Host Authority

Sessions are **not** linear (`created → active → completed`) — model explicitly as a state graph with `host_disconnected`, `participant_reconnecting`, `degraded_offline`, `force_terminated` as first-class states (recommend XState or equivalent, not ad-hoc booleans). **Implemented Phase 2 task 2.6:** `apps/mobile/src/machines/session-lifecycle-machine.ts` (the graph) + `apps/mobile/src/hooks/use-session.ts` (the only driver — REST-hydrates, then feeds realtime events in; Broadcast events only ever drive the machine, never write `session` state directly).

- **Duration modes:** `fixed` (planned_duration_minutes set at creation) or `open_ended` ("until I close it").
- **Activation (Phase 4 decision):** a session activates immediately at creation — `status='active'` and `started_at=now()` are set in the same insert as session creation, and the host's own `session_presence_intervals` row (open, `joined_at=started_at`) is inserted at the same time. No separate "start" step exists in the screens spec (Create → straight to Active Session), so `pending` is not reachable via the current create flow — it stays modeled for a possible future explicit-start flow.
- **Host authority is real and ongoing**, not just at creation: the host can close the session at any time regardless of mode.
- **Host migration:** an in-process worker inside `apps/server` (Phase 4 decision — no separate deployment/scheduling infra exists yet, a listed known gap; revisit if/when real deployment topology is decided) subscribes to Presence for every active session. If the host's presence key is absent for **>20s** (tunable, debounced to avoid migration storms on brief drops), the server promotes whichever active participant has the **highest cumulative `minutes_present` in that session** (not earliest joiner; ties broken by earliest current-interval `joined_at`, i.e. whoever has been continuously present longest), updates `sessions.host_id`, logs it in `session_host_assignments`, and broadcasts `host_migrated`. Only the newly-promoted host gets a small, calm, few-second toast — no notification to the old host or other participants. If no other participant is present to promote (including solo sessions), the session simply stays in `host_disconnected` indefinitely — no separate timeout; resolved only by the host reconnecting or by whatever end-of-lifetime mechanism already applies (the fixed-duration/24h auto-close below).
- **Stale-participant reconciliation:** the same worker closes any participant's (non-host) open presence interval, with `disconnect_reason='involuntary_disconnect'`, after their Presence key has been absent for `PARTICIPANT_PRESENCE_TIMEOUT_MINUTES` (30 min — matching the native offline-cutoff grace period, §4, so a participant isn't penalized for the same offline window the native layer is supposed to tolerate). This is what lets session-end finalization terminate even for a participant who went offline and never came back (see the new `disconnected` exit_reason below).
- **Open-ended session cap:** server-enforced max lifetime, default **24h** (config constant, not hardcoded logic), after which the server force-closes it (`end_reason='force_terminated'`); the host must create a new session to continue.
- **Fixed-duration auto-close (Phase 4 decision):** the same generalized auto-close sweep also force-closes a `fixed`-duration session once `planned_duration_minutes` has elapsed since `started_at` — fully server-authoritative rather than relying on the host's client being open (Money-Equivalent Logic Rule); this is what `end_reason='planned_duration_reached'` actually means when nobody explicitly taps "end."
- **End reasons:** `host_ended`, `planned_duration_reached` (host-triggered or auto-close), or `force_terminated` (the 24h open-ended cap only) — all three are non-punitive (`completed`) for every participant still present. Only a participant's own `emergency_exit` (or an `involuntary_disconnect` that reconciliation later finalizes as `disconnected`) is punitive (forfeits both bonuses; base points for actual minutes present are always kept).
- **Rejoin:** unlimited, any time, no cutoff window — a participant's own decision. Each rejoin opens a new `session_presence_intervals` row (does not resurrect the old one). A gap (voluntary or involuntary) always disqualifies that participant's Completion Bonus for the session, and breaks their own personal continuity toward the Group Bonus streak.

## 7. Points & Bonus Engine

**Base:** `points = total_minutes_present × 1 pt/min` — always linear, for every exit type and duration mode. No separate proration formula; "actual vs. planned" was resolved to mean nothing more than "you get points for the minutes you were actually there."

**Group Bonus (+10%):**
- Requires a continuous stretch where concurrent participant count ≥5 for ≥30 minutes.
- The streak resets fully to zero (no partial credit banking) the instant count drops below 5.
- A participant qualifies only if *their own* presence was unbroken for the entire duration of a qualifying streak (joining mid-streak still qualifies if they stay unbroken until it hits 30 min; their own disconnect/rejoin breaks their personal eligibility even if the group streak itself survives).
- **Confirmed:** resets are count-based — the clock only resets if a departure takes the group below 5. If 6 people are present and one leaves (count stays at 5), the remaining participants' clock is unaffected.
- **Confirmed:** a joining participant only counts toward the 5+ threshold once their device has completed local blocker setup (not merely tapped "join") — closes the Sybil/bonus-farming vector described in §8 item 9.

**Completion Bonus (+10%):**
- Session's actual duration must reach ≥60 minutes (for open-ended sessions: must actually run ≥60 min before the host closes it).
- Participant must have joined at the very start of the session (practical tolerance ~60s from `started_at`).
- Zero disconnects for that participant for the entire session — any gap (voluntary or involuntary) disqualifies it.
- `exit_reason` must be `completed`.

**Stacking:** additive — both bonuses together = +20%, never compounded.

**Emergency exit:** keeps base points for actual minutes present; forfeits both Group and Completion bonus entirely, regardless of how close they were to qualifying.

**Confirmed:** base rate is 1 point per minute present.

## 8. Security & Anti-Abuse Threat Model

| # | Attack / failure mode | Mitigation | Priority |
|---|---|---|---|
| 1 | Force-stop app / kill foreground service | Boot persistence + heartbeat; missing heartbeat ⇒ violation, prorate to last-seen | MVP |
| 2 | Revoke Usage Access/Overlay permission mid-session | Native module self-polls permission state; loss triggers local violation event | MVP |
| 3 | Reboot into Android Safe Mode | Unfixable by design of the OS; accepted limitation, heartbeat-gap reconciliation only | MVP (documented limitation) |
| 4 | Uninstall + reinstall mid-session | Server-side heartbeat gap is the only signal; prorate to last confirmed heartbeat | MVP |
| 5 | Manipulate device clock/timezone | Server issues authoritative timestamps; native timer re-syncs against server time, never trusts device clock alone | MVP |
| 6 | Use a second device/profile without the app at all | No technical prevention possible; explicitly out of scope — commitment device, not a jail; covered in ToS | Accepted limitation |
| 7 | Rooted/jailbroken device hooking the blocking service | Root/jailbreak detection flags session "unverified"; exclude from group bonus only, never block usage (false-positive risk) | Post-MVP hardening |
| 8 | Emulator used to create **or** join a session | Play Integrity API (Android) / DeviceCheck-App Attest (iOS); monitor-mode rollout first, then only lowest integrity tier excluded from group bonus/streak — never blocks Solo Mode or general usage. **Monitor-mode pipeline implemented Phase 2** (`apps/server/src/modules/attestation/`): every verdict + full raw response lands in `public.device_attestations` (Node-internal only, no client read path), ready for the Phase 6 threshold analysis; real provider credentials still outstanding — see `docs/MANUAL_QA.md`. | MVP |
| 9 | Sybil accounts joining just to cross the "5+" bonus threshold | Verified auth only (no anonymous accounts); rate-limit account creation per device via attestation; joiner only counts toward threshold once local blocker setup completes (confirmed, see §7) | MVP |
| 10 | Modified client / direct API calls faking "session complete" | Server never accepts a client's self-report; points finalized only from server-observed heartbeats + native-attested compliance events | MVP |
| 11 | Replayed/forged Realtime broadcast messages (e.g., spoofed `session_ended`) | Broadcast is UI-hint only; anything affecting points is re-confirmed against Postgres CDC | MVP |
| 12 | QR token screenshotted/shared beyond audience, or reused after expiry | Signed token (HMAC) + server-side expiry/capacity check + per-token join rate-limiting | MVP |
| 13 | OEM aggressive battery-optimization killing the foreground service | Onboarding prompt to disable battery optimization for the app; reliability issue, not abuse | MVP (UX) |

## 9. Gamification Philosophy

> ⚠️ **Under active revision — see the product-direction note in §1.** The owner has decided to pivot toward deliberate engagement/retention ("ethical addictiveness" in service of less overall phone use). The Keep/Avoid lists below are the *pre-pivot* spec and are pending re-evaluation; the "Avoid" items (variable/randomized rewards, social comparison, etc.) are explicitly **on the table** now and must not be treated as settled. No specific mechanic is decided until the retention-strategy analysis is done and agreed (tracked in `backlog.md`).

Keep: streaks (48h flexible grace — one session per 48h keeps it alive), milestones (global, periodic, not per-session — avoids "reward after every session" cognitive load), transparent point receipts (bonuses broken out separately, never bundled opaquely).

Avoid: leaderboards/social comparison, variable/randomized rewards, badge overload, idle-animating gamification elements (e.g., a flame that pulses with no state change).

## 10. B2B / Verified Host

- `verified_host` role, manual admin approval (MVP — no self-serve approval flow).
- Static QR tied to a named `venue` record (label only — no GPS/geolocation collected or required; this is a display/grouping label for the business's printed QR code, not a location feature).
- **MVP:** in-app business screen (gated by role) showing two headline metrics: average session duration per customer, concurrent active customers.
- **V2:** separate web dashboard with richer analytics (explicitly deferred, not in MVP scope).

## 11. Open Decisions

None remaining — all three items (Group Bonus reset semantics, Sybil setup-completion gate, base point rate) confirmed. §7 and §8 reflect the final, locked spec. Phase 4's point/bonus math can proceed to test-writing.
