import FamilyControls
import Foundation
import ManagedSettings

// Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §7): the App Group store behind
// the iOS join step.
//
// **This file is deliberately dumb.** It stores things under keys and hands
// them back. Every decision — whether the map covers this blocklist, whether
// one item can be learned by subtraction, whether to show the picker at all
// — is made in JS (apps/mobile/src/services/ios-blocklist-selection.ts) and
// arrives here as an instruction.
//
// That split is not stylistic. Swift is the one place this project cannot
// test (no Mac, §12), and a bug in that rule would be silent, permanent, and
// invisible until someone earned points with nothing blocked. So the rule
// lives where it can have unit tests, and this side is reduced to a keyed
// store with no branching to get wrong.
//
// Two things are stored:
//
//   * **The token map**, id -> token. `id` is our own cross-device string (a
//     category name like "social", or a package name like
//     "com.instagram.android"); the token is Apple's opaque handle. Tokens
//     cannot cross the bridge and cannot be turned back into ids, so JS is
//     only ever told the KEYS.
//   * **The selection cache**, blocklist-key -> the whole selection made for
//     it. Reused when an identical blocklist comes round again, so a repeat
//     session shows no picker.
//
// Accepted limitation (plan §2/§7, owner decision): iOS reissues these
// tokens unpredictably. A stale entry silently shields nothing and there is
// no API that reports it. Expiring entries after N days would bound the
// exposure, but that is a periodic re-prompt by another name, which was
// offered and declined. It fails in the under-blocking direction, which
// never buys anyone points they didn't earn.
enum BlocklistTokenStore {
  private enum Keys {
    static let applicationTokens = "blocklist.applicationTokens"
    static let categoryTokens = "blocklist.categoryTokens"
    static let selectionCachePrefix = "blocklist.selectionCache."
  }

  private static var defaults: UserDefaults? { SharedAppGroup.userDefaults }

  // MARK: - The token map

  private static func loadApplicationTokens() -> [String: ApplicationToken] {
    guard let data = defaults?.data(forKey: Keys.applicationTokens),
      let decoded = try? PropertyListDecoder().decode([String: ApplicationToken].self, from: data)
    else { return [:] }
    return decoded
  }

  private static func loadCategoryTokens() -> [String: ActivityCategoryToken] {
    guard let data = defaults?.data(forKey: Keys.categoryTokens),
      let decoded = try? PropertyListDecoder().decode(
        [String: ActivityCategoryToken].self, from: data)
    else { return [:] }
    return decoded
  }

  private static func save(applicationTokens: [String: ApplicationToken]) {
    guard let data = try? PropertyListEncoder().encode(applicationTokens) else { return }
    defaults?.set(data, forKey: Keys.applicationTokens)
  }

  private static func save(categoryTokens: [String: ActivityCategoryToken]) {
    guard let data = try? PropertyListEncoder().encode(categoryTokens) else { return }
    defaults?.set(data, forKey: Keys.categoryTokens)
  }

  /// Every id this device already holds a token for. Keys only — the tokens
  /// themselves are opaque and cannot cross the bridge.
  static func knownIds() -> [String] {
    Array(loadApplicationTokens().keys) + Array(loadCategoryTokens().keys)
  }

  /// Builds a selection entirely from already-held tokens. Returns nil if any
  /// id is missing, so the caller never applies a partial blocklist believing
  /// it applied the whole one.
  static func composeSelection(for ids: [String]) -> FamilyActivitySelection? {
    let applications = loadApplicationTokens()
    let categories = loadCategoryTokens()

    var selection = FamilyActivitySelection()
    for id in ids {
      if let token = applications[id] {
        selection.applicationTokens.insert(token)
      } else if let token = categories[id] {
        selection.categoryTokens.insert(token)
      } else {
        return nil
      }
    }
    return selection
  }

  /// Learns one id's token by subtraction: whatever the user added to a
  /// pre-seeded picker IS that id.
  ///
  /// Only ever called with a single unknown id, and the guards below are the
  /// second half of that contract — if the difference is anything other than
  /// exactly one token, nothing is written. A wrong entry here would be
  /// permanent and undetectable, so declining to learn is always the safer
  /// outcome.
  static func learn(id: String, before: FamilyActivitySelection, after: FamilyActivitySelection) {
    let addedApplications = after.applicationTokens.subtracting(before.applicationTokens)
    let addedCategories = after.categoryTokens.subtracting(before.categoryTokens)

    if addedApplications.count == 1, addedCategories.isEmpty,
      let token = addedApplications.first
    {
      var map = loadApplicationTokens()
      map[id] = token
      save(applicationTokens: map)
      return
    }

    if addedCategories.count == 1, addedApplications.isEmpty, let token = addedCategories.first {
      var map = loadCategoryTokens()
      map[id] = token
      save(categoryTokens: map)
    }
  }

  // MARK: - The per-blocklist selection cache

  static func cachedSelection(for key: String) -> FamilyActivitySelection? {
    guard let data = defaults?.data(forKey: Keys.selectionCachePrefix + key) else { return nil }
    return try? PropertyListDecoder().decode(FamilyActivitySelection.self, from: data)
  }

  static func cache(selection: FamilyActivitySelection, for key: String) {
    guard let data = try? PropertyListEncoder().encode(selection) else { return }
    defaults?.set(data, forKey: Keys.selectionCachePrefix + key)
  }
}
