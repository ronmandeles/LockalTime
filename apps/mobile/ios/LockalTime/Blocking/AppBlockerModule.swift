import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

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
    resolve(nil)
  }

  @objc(stop:rejecter:)
  func stop(_ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock) {
    clearShield()
    DeviceActivityCenter().stopMonitoring([Self.activityName])
    SharedAppGroup.clearActiveSession()
    resolve(nil)
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
  // happens to cross midnight, but has NOT been reasoned through fully for
  // sessions that might span more than 24h (shouldn't happen: fixed
  // sessions are bounded by product design, and open-ended ones are capped
  // at exactly 24h below). Treat this as an accepted rough edge pending
  // real-device verification.
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
