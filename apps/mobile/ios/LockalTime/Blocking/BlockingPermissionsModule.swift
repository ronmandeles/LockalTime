import FamilyControls
import Foundation
import SwiftUI
import UIKit

// Phase 3 task 3.6 (backlog.md): the real iOS half of the blockingPermissions
// seam (apps/mobile/src/services/blocking-permissions.ts) — replaces the
// Phase 1/Android-only-real placeholder now that this exists. Reports ONE
// combined status the same way the Android module does: 'granted' only
// once FamilyControls authorization is approved AND the user has completed
// the one-time category picker (see ActivityPickerHostView) — an approved
// authorization alone isn't enough to actually shield anything, since
// there's no FamilyActivitySelection to apply yet.
//
// NOT compiled or run anywhere in this repo (no Mac) — written to match
// FamilyControls' documented async/await authorization API as precisely as
// possible, but unverified; treat as a strong first draft.
@objc(BlockingPermissionsModule)
class BlockingPermissionsModule: NSObject {

  private func currentStatusDictionary() -> [String: String] {
    let authorized = AuthorizationCenter.shared.authorizationStatus == .approved
    let hasSelection = SharedAppGroup.hasFamilyActivitySelection()
    return ["status": authorized && hasSelection ? "granted" : "denied"]
  }

  @objc(getStatus:rejecter:)
  func getStatus(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(currentStatusDictionary())
  }

  @objc(request:rejecter:)
  func request(
    _ resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    Task {
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
      } catch {
        // User declined, or the entitlement isn't approved yet — either way
        // this is an answer, not an error (matches the JS contract: neither
        // call ever rejects).
        resolve(["status": "denied"])
        return
      }

      guard AuthorizationCenter.shared.authorizationStatus == .approved else {
        resolve(["status": "denied"])
        return
      }

      await presentActivityPicker { selection in
        if let selection, !selection.categoryTokens.isEmpty {
          SharedAppGroup.saveFamilyActivitySelection(selection)
          resolve(["status": "granted"])
        } else {
          // Cancelled, or finished with nothing selected — nothing to
          // shield, so this is not a completed grant.
          resolve(["status": "denied"])
        }
      }
    }
  }

  @MainActor
  private func presentActivityPicker(completion: @escaping (FamilyActivitySelection?) -> Void) async {
    guard
      let rootViewController = UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.keyWindow })
        .first?.rootViewController
    else {
      completion(nil)
      return
    }

    let initialSelection = SharedAppGroup.loadFamilyActivitySelection() ?? FamilyActivitySelection()
    let hostingController = UIHostingController(
      rootView: ActivityPickerHostView(initialSelection: initialSelection) { selection in
        rootViewController.dismiss(animated: true)
        completion(selection)
      }
    )
    hostingController.modalPresentationStyle = .formSheet
    rootViewController.present(hostingController, animated: true)
  }
}
