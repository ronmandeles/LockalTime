import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
import Network

// Phase 3 task 3.6 (backlog.md): the real iOS AppBlockerModule
// (apps/mobile/src/services/app-blocker.ts's native seam). Applies the
// shield immediately on start() (so blocking begins right away, not only
// once DeviceActivityCenter's scheduled interval technically starts) and
// schedules DeviceActivityMonitorExtension to guarantee cleanup at session
// end even if this app is suspended/killed — ARCHITECTURE.md §4's "the
// extension itself, not the JS layer, is responsible for clearing the
// shield at session end". Events relay through the RCTEventEmitter base
// class; the extension writes to SharedAppGroup and this module has no way
// to be woken up to relay THOSE further (the main app might not be
// running) — see DeviceActivityMonitorExtension.swift's header for how
// on-relaunch reconciliation is expected to work instead.
//
// NOT compiled or run anywhere in this repo (no Mac) — see
// SharedAppGroup.swift's header for the same caveat. DeviceActivitySchedule
// models a recurring time-of-day window, not an arbitrary absolute
// start/end — see scheduleMonitoring's comment for the resulting
// midnight-spanning-session edge case, an accepted rough edge for now
// (same posture as the Android category-mapping limitation in
// ARCHITECTURE.md §4).
@objc(AppBlockerModule)
class AppBlockerModule: RCTEventEmitter {

  private static let activityName = DeviceActivityName("com.lockaltime.blocking.session")
  // Server enforces a 24h max for open-ended sessions (ARCHITECTURE.md §6)
  // — mirrored here as the schedule length when no endsAt was given, since
  // DeviceActivitySchedule needs a concrete end.
  private static let openEndedCapSeconds: TimeInterval = 24 * 60 * 60

  // ARCHITECTURE.md §4 "Offline mode": 30-minute offline enforcement
  // window. IMPORTANT PLATFORM DIFFERENCE from Android (documented, not an
  // oversight): Android's foreground service keeps polling while fully
  // backgrounded, so its cutoff detection (BlockerForegroundService.kt) is
  // reliable for the whole session. iOS has no equivalent always-on
  // background primitive available here — DeviceActivityMonitorExtension's
  // callbacks are schedule-start/end/threshold events, not a continuous
  // polling hook, so they can't drive a live network check either. This
  // NWPathMonitor-based timer only runs while this module's process is
  // alive (foreground, or the brief window iOS grants a backgrounded app
  // before suspension) — a genuine accepted limitation for now, the same
  // category as §4's documented Android Safe Mode gap, not something to
  // paper over. A more complete fix (e.g. a background network extension)
  // is future work once real-device testing is possible.
  private static let offlineCutoffSeconds: TimeInterval = 30 * 60
  private let pathMonitor = NWPathMonitor()
  private let pathMonitorQueue = DispatchQueue(label: "com.lockaltime.blocking.pathMonitor")
  private var lastConnectedAt = Date()
  private var offlineCheckTimer: Timer?

  override static func requiresMainQueueSetup() -> Bool {
    false
  }

  override func supportedEvents() -> [String]! {
    ["shield_triggered", "service_killed", "permission_revoked", "battery_critical", "offline_cutoff_reached"]
  }

  @objc(start:resolver:rejecter:)
  func start(
    _ config: NSDictionary,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let sessionId = config["sessionId"] as? String else {
      resolve(nil)
      return
    }
    let endsAt = (config["endsAt"] as? String).flatMap { ISO8601DateFormatter().date(from: $0) }

    guard let selection = SharedAppGroup.loadFamilyActivitySelection() else {
      // No category selection exists yet — the permission flow never
      // completed a picker session. Fail-open: never crash, just no-op,
      // matching Android's posture when its native module is unavailable.
      resolve(nil)
      return
    }

    applyShield(selection: selection)
    SharedAppGroup.saveActiveSession(sessionId: sessionId, endsAt: endsAt)
    scheduleMonitoring(endsAt: endsAt)
    startOfflineMonitoring(sessionId: sessionId)
    resolve(nil)
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    clearShield()
    DeviceActivityCenter().stopMonitoring([Self.activityName])
    SharedAppGroup.clearActiveSession()
    stopOfflineMonitoring()
    resolve(nil)
  }

  // See the offlineCutoffSeconds doc comment above for the platform
  // difference from Android this accepts. Assumes connected at start — a
  // device already offline when a session starts gets the same 30-minute
  // grace as one that drops mid-session.
  private func startOfflineMonitoring(sessionId: String) {
    lastConnectedAt = Date()
    pathMonitor.pathUpdateHandler = { [weak self] path in
      if path.status == .satisfied {
        self?.lastConnectedAt = Date()
      }
    }
    pathMonitor.start(queue: pathMonitorQueue)

    offlineCheckTimer?.invalidate()
    let timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
      self?.checkOfflineCutoff(sessionId: sessionId)
    }
    RunLoop.main.add(timer, forMode: .common)
    offlineCheckTimer = timer
  }

  private func stopOfflineMonitoring() {
    pathMonitor.cancel()
    offlineCheckTimer?.invalidate()
    offlineCheckTimer = nil
  }

  private func checkOfflineCutoff(sessionId: String) {
    guard Date().timeIntervalSince(lastConnectedAt) >= Self.offlineCutoffSeconds else { return }

    // Self-enforces the cutoff by lifting the block, per ARCHITECTURE.md
    // §4 — JS only surfaces the resulting state when it wakes, it never
    // decides this. Deliberately does NOT decide session end_reason or
    // points (Money-Equivalent Logic Rule) — that's the server's job once
    // connectivity resumes and the client reconciles.
    sendEvent(
      withName: "offline_cutoff_reached",
      body: ["sessionId": sessionId, "lastConnectedAt": ISO8601DateFormatter().string(from: lastConnectedAt)]
    )
    clearShield()
    DeviceActivityCenter().stopMonitoring([Self.activityName])
    SharedAppGroup.clearActiveSession()
    stopOfflineMonitoring()
  }

  @objc(getStatus:rejecter:)
  func getStatus(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    guard let sessionId = SharedAppGroup.currentSessionId() else {
      resolve(["state": "inactive"])
      return
    }

    guard AuthorizationCenter.shared.authorizationStatus == .approved else {
      resolve(["state": "violation", "sessionId": sessionId, "reason": "permission_revoked"])
      return
    }

    resolve(["state": "active", "sessionId": sessionId])
  }

  private func applyShield(selection: FamilyActivitySelection) {
    let store = ManagedSettingsStore()
    store.shield.applicationCategories = .specific(selection.categoryTokens)
    store.shield.webDomainCategories = .specific(selection.categoryTokens)
  }

  private func clearShield() {
    ManagedSettingsStore().clearAllSettings()
  }

  // DeviceActivitySchedule describes a time-of-day window (e.g. "9:00 to
  // 17:00 every day it's scheduled for"), not an arbitrary absolute
  // start/end — Apple's framework interprets intervalEnd < intervalStart as
  // "wraps into the next day", which correctly handles a session that
  // happens to cross midnight. A session longer than 24h would silently
  // truncate to (duration mod 24h) here (only hour/minute/second survive
  // the round trip below, the day is discarded) -- Phase 7's code review
  // (backlog.md) found this was NOT actually enforced anywhere despite this
  // comment's original assumption, and closed it server-side:
  // FIXED_SESSION_MAX_DURATION_MINUTES (apps/server/src/config/constants.ts)
  // now caps a fixed session's planned_duration_minutes at 24h, matching
  // OPEN_ENDED_SESSION_MAX_HOURS' existing bound for open-ended sessions
  // below -- so every session this module ever schedules is now guaranteed
  // <= 24h. The exact-24h boundary itself (start and end landing on the
  // identical time-of-day) is still an accepted rough edge pending
  // real-device verification, same as it already was for the open-ended
  // cap before this phase.
  private func scheduleMonitoring(endsAt: Date?) {
    let calendar = Calendar.current
    let now = Date()
    let resolvedEnd = endsAt ?? now.addingTimeInterval(Self.openEndedCapSeconds)

    let start = calendar.dateComponents([.hour, .minute, .second], from: now)
    let end = calendar.dateComponents([.hour, .minute, .second], from: resolvedEnd)
    let schedule = DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false)

    do {
      try DeviceActivityCenter().startMonitoring(Self.activityName, during: schedule)
    } catch {
      // Fail-open: the shield above is already applied regardless, so
      // blocking still works while this app/extension are alive — this
      // only loses the extension's guaranteed end-of-interval cleanup.
    }
  }
}
