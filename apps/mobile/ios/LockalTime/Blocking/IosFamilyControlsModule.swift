import FamilyControls
import Foundation
import ManagedSettings
import React
import SwiftUI
import UIKit

// Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §7): the native half of the iOS
// join step — how a member acquires tokens for a blocklist that arrived from
// our server as plain strings.
//
// **This module makes no decisions.** JS
// (apps/mobile/src/services/ios-family-controls.ts) reads the map's keys,
// picks a strategy, and calls exactly one of these methods with the answer.
// Everything here is store-and-apply. That split is why the rule can have
// unit tests at all: Swift is the one place this project cannot test (no
// Mac, §12), and a bug in that rule would be silent, permanent, and
// invisible until someone earned points with nothing blocked.
//
// Written to match the documented FamilyControls APIs as precisely as
// possible and compiled only by cloud macOS CI — never run. See
// SharedAppGroup.swift's header for the same standing caveat.
@objc(IosFamilyControlsModule)
class IosFamilyControlsModule: NSObject {

  @objc static func requiresMainQueueSetup() -> Bool { true }

  /// The token map's KEYS only. The tokens are opaque and cannot cross the
  /// bridge — which is the whole reason the decision rule lives in JS and
  /// reads this instead.
  @objc
  func getKnownIds(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(BlocklistTokenStore.knownIds())
  }

  /// Applies a selection composed entirely from already-held tokens. No UI.
  /// Resolves false — never throws — if any id is missing, so JS can fall
  /// back to the picker rather than joining with a partial blocklist.
  @objc
  func applyKnownSelection(
    _ ids: [String], resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let selection = BlocklistTokenStore.composeSelection(for: ids) else {
      resolve(false)
      return
    }
    SharedAppGroup.saveFamilyActivitySelection(selection)
    resolve(true)
  }

  /// Reuses the selection saved for this exact blocklist, if there is one.
  /// The key is computed in JS over the whole blocklist, so adding a single
  /// app is a different key and correctly re-prompts.
  @objc
  func applyCachedSelection(
    _ cacheKey: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard let selection = BlocklistTokenStore.cachedSelection(for: cacheKey) else {
      resolve(false)
      return
    }
    SharedAppGroup.saveFamilyActivitySelection(selection)
    resolve(true)
  }

  /// Presents Apple's picker, pre-seeded with whatever tokens we already
  /// hold, with the list of what to select rendered inside Apple's own sheet
  /// so the member isn't working from memory of the previous screen.
  ///
  /// `learnId`, when present, names the single item we don't have a token
  /// for: whatever the user adds is that item, by subtraction. It is never
  /// more than one — with two unknowns the difference is a set of two tokens
  /// with no way to tell them apart.
  @objc
  func presentPicker(
    _ options: NSDictionary, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let seedIds = options["seedIds"] as? [String] ?? []
    let learnId = options["learnId"] as? String
    let cacheKey = options["cacheKey"] as? String ?? ""
    let headerText = options["headerText"] as? String ?? ""
    let footerText = options["footerText"] as? String ?? ""

    // Composing the seed can fail if a seeded token has rotated; an empty
    // seed is still a usable picker, just one with nothing pre-ticked.
    let seed = BlocklistTokenStore.composeSelection(for: seedIds) ?? FamilyActivitySelection()

    DispatchQueue.main.async {
      guard let presenter = Self.topViewController() else {
        resolve(false)
        return
      }

      let host = UIHostingController(
        rootView: BlocklistPickerHostView(
          initialSelection: seed,
          headerText: headerText,
          footerText: footerText
        ) { completed in
          presenter.dismiss(animated: true)

          // Explicit optional binding rather than Swift 5.7's shorthand:
          // nothing here pins the Xcode/Swift version CI runs, and this
          // file is only ever compiled there.
          guard let completed = completed else {
            // Dismissed. JS turns this into "not joined" — there is no
            // half-joined state (plan §9).
            resolve(false)
            return
          }

          if let learnId = learnId {
            BlocklistTokenStore.learn(id: learnId, before: seed, after: completed)
          }
          BlocklistTokenStore.cache(selection: completed, for: cacheKey)
          SharedAppGroup.saveFamilyActivitySelection(completed)
          resolve(true)
        }
      )
      presenter.present(host, animated: true)
    }
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.first { $0.activationState == .foregroundActive }
    guard let windowScene = scene as? UIWindowScene,
      let root = windowScene.windows.first(where: { $0.isKeyWindow })?.rootViewController
    else { return nil }

    var top = root
    while let presented = top.presentedViewController {
      top = presented
    }
    return top
  }
}
