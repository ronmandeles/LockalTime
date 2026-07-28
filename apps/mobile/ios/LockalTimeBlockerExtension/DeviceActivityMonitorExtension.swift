import DeviceActivity
import Foundation
import ManagedSettings

// Phase 3 task 3.6 (backlog.md): the "Device Activity Monitor Extension"
// target (LockalTimeBlockerExtension) is created by Phase 7's scripted
// Xcode wiring (apps/mobile/ios/scripts/wire-blocking-target.rb), which
// also gives this file's target the App Groups capability and shares
// SharedAppGroup.swift into it — see docs/MANUAL_QA.md's iOS section and
// that script's own comments for the full mechanics. Compiled for the
// first time in Phase 7 via cloud macOS CI.
//
// Runs as a SEPARATE OS PROCESS from the main app (ARCHITECTURE.md §4's
// "critical constraint") — the system guarantees this class's callbacks
// fire even if the main app is suspended or killed, which is the entire
// reason this extension exists: intervalDidEnd is what actually clears the
// shield reliably, not any JS/main-app code path.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  private let store = ManagedSettingsStore()

  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    guard let selection = SharedAppGroup.loadFamilyActivitySelection() else { return }
    store.shield.applicationCategories = .specific(selection.categoryTokens)
    store.shield.webDomainCategories = .specific(selection.categoryTokens)
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    // Guaranteed cleanup even if the main app was suspended/killed when the
    // session's scheduled end arrived — see the file header.
    // clearAllSettings() needs iOS 16+ (caught by the real ios-build CI
    // compile, Phase 7); this project's deployment target is 15.1, so
    // clearing exactly the two shield properties intervalDidStart() sets
    // is the narrower fix, same reasoning as AppBlockerModule.swift's
    // clearShield().
    store.shield.applicationCategories = nil
    store.shield.webDomainCategories = nil
    SharedAppGroup.clearActiveSession()
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    // No usage-threshold DeviceActivityEvents are configured in
    // AppBlockerModule.scheduleMonitoring yet (only the schedule's own
    // start/end) — reserved for a future per-category usage-limit feature;
    // currently unreachable, so this is a no-op.
  }
}
