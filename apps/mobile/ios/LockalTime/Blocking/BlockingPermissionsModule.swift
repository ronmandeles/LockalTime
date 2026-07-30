import FamilyControls
import Foundation
// React Native visibility (RCTPromiseResolveBlock/RCTPromiseRejectBlock) —
// see AppBlockerModule.swift's identical comment for why this Swift-module
// import, not the bridging header, is the mechanism this RN template
// actually needs (confirmed by real xcodebuild CI, Phase 7).
import React
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
// Compiled for the first time in Phase 7 via cloud macOS CI (see
// SharedAppGroup.swift's header) — written to match FamilyControls'
// documented async/await authorization API as precisely as possible; a real
// device is still needed for functional verification (docs/MANUAL_QA.md).
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
        // requestAuthorization(for:) needs iOS 16+ (caught by the real
        // ios-build CI compile, Phase 7); this project's deployment
        // target is 15.1. Apple's async, no-parameter overload turned out
        // to ALSO be iOS 16+ only (a second real CI-caught error, "missing
        // argument for parameter 'completionHandler'" -- iOS 15.0
        // apparently only ever exposed the completion-handler-style
        // entry point for this call, no bare-async version at all), so the
        // iOS 15 fallback bridges that older API via a checked
        // continuation instead -- the standard Swift pattern for adopting
        // async/await over a completion-handler API, and definitely
        // available since iOS 15.0 since it's the original Objective-C-
        // compatible entry point. .individual is the only member kind iOS
        // 15's FamilyControls supports at all; .child-style parental
        // supervision was the iOS 16 addition the `for:` parameter on the
        // newer overload exists to select between, and this app never
        // uses it.
        if #available(iOS 16.0, *) {
          try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
        } else {
          // Real xcodebuild CI (Phase 7): this completion handler's
          // parameter is Result<Void, Error>, not Error? -- an optional-
          // binding guess that compiled fine as *syntax* but not as the
          // actual completion-handler type the SDK declares.
          try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            AuthorizationCenter.shared.requestAuthorization { result in
              switch result {
              case .success:
                continuation.resume()
              case .failure(let error):
                continuation.resume(throwing: error)
              }
            }
          }
        }
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
