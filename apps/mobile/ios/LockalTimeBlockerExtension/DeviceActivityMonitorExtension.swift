import DeviceActivity
import Foundation
import ManagedSettings

// Phase 3 task 3.6 (backlog.md): this file is NOT part of any Xcode target
// yet — per the decision to avoid hand-editing project.pbxproj blind, a
// real "Device Activity Monitor Extension" target must be created manually
// in Xcode (File > New > Target…) once a Mac is available, and this file
// (plus SharedAppGroup.swift, given "Target Membership" in both the main
// app and this extension) added to it. Full steps in docs/MANUAL_QA.md's
// "iOS extension target setup" section. NOT compiled anywhere in this repo.
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
    store.clearAllSettings()
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
