import FamilyControls
import Foundation

// Phase 3 task 3.6 (backlog.md): the App Group bridge (ARCHITECTURE.md §4)
// between the main app target and the DeviceActivityMonitor extension —
// they run as separate OS processes and cannot call each other directly,
// so a shared UserDefaults suite is the only channel. Both targets get the
// "App Groups" capability with this exact group identifier via Phase 7's
// scripted Xcode wiring (apps/mobile/ios/scripts/wire-blocking-target.rb),
// not a manual Xcode-GUI step anymore — see docs/MANUAL_QA.md's iOS section.
//
// Compiled for the first time in Phase 7 via cloud macOS CI
// (.github/workflows/ci.yml's ios-build job) — written to match
// FamilyControls/ManagedSettings/DeviceActivityMonitor's documented APIs as
// precisely as possible; see that job's status for the current build result.
// A real Mac/device is still needed for the functional (not just
// compile-time) verification in docs/MANUAL_QA.md.
enum SharedAppGroup {
  static let identifier = "group.com.lockaltime.app"

  static var userDefaults: UserDefaults? {
    UserDefaults(suiteName: identifier)
  }

  private enum Keys {
    static let sessionId = "blocker.sessionId"
    static let endsAt = "blocker.endsAt"
    static let familyActivitySelection = "blocker.familyActivitySelection"
  }

  // The one-time category selection (Social/Games/Entertainment, matched as
  // closely as the FamilyActivityPicker's own category list allows) made via
  // BlockingPermissionsModule's picker flow. FamilyActivitySelection's
  // ActivityCategoryTokens are opaque — Apple deliberately never lets the
  // app learn which real-world apps/categories a token represents; the app
  // only ever re-applies the same opaque tokens the user picked once.
  static func saveFamilyActivitySelection(_ selection: FamilyActivitySelection) {
    guard let data = try? PropertyListEncoder().encode(selection) else { return }
    userDefaults?.set(data, forKey: Keys.familyActivitySelection)
  }

  static func loadFamilyActivitySelection() -> FamilyActivitySelection? {
    guard let data = userDefaults?.data(forKey: Keys.familyActivitySelection) else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  static func hasFamilyActivitySelection() -> Bool {
    loadFamilyActivitySelection() != nil
  }

  // Current session snapshot — read by the extension (to know what to shield
  // when its interval starts) and by the main app on relaunch (to reconcile
  // "was a session mid-flight when I was killed/restarted").
  static func saveActiveSession(sessionId: String, endsAt: Date?) {
    userDefaults?.set(sessionId, forKey: Keys.sessionId)
    userDefaults?.set(endsAt, forKey: Keys.endsAt)
  }

  static func clearActiveSession() {
    userDefaults?.removeObject(forKey: Keys.sessionId)
    userDefaults?.removeObject(forKey: Keys.endsAt)
  }

  static func currentSessionId() -> String? {
    userDefaults?.string(forKey: Keys.sessionId)
  }

  static func currentEndsAt() -> Date? {
    userDefaults?.object(forKey: Keys.endsAt) as? Date
  }
}
