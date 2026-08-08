import FamilyControls
import SwiftUI

// Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §7): the picker an iOS member
// sees when joining a session whose blocklist this device has no tokens for.
//
// Distinct from ActivityPickerHostView (Phase 3), which asks the user what
// THEY want blocked, once, during permission priming. This one shows them a
// list someone else chose and asks them to find those same items — a
// re-selection, not a confirmation. We cannot pre-tick a first-time
// selection, because pre-ticking needs the tokens and not having them is the
// entire reason the step exists.
//
// **The instruction text is drawn by us, not by Apple.** The plan called for
// FamilyActivityPicker's own `headerText`/`footerText` parameters so the list
// renders inside Apple's sheet — but that initializer is **iOS 16+**, and
// this project's deployment target is 15.1 (IPHONEOS_DEPLOYMENT_TARGET in
// project.pbxproj). Using it would not degrade at runtime; it would fail to
// compile, and only in cloud macOS CI, since nothing here can build iOS.
//
// The alternative to our own chrome was `if #available(iOS 16, *)` with two
// paths. Rejected deliberately: Swift is the one place this project cannot
// test, so a second untested branch costs more than it buys. Our own header
// sits outside the picker's rectangle rather than inside Apple's list, which
// is cosmetically worse and functionally the same — the member can still read
// what to select while using Apple's search field. Whether it stays visible
// when the picker drills into a category is a real-device question
// (docs/MANUAL_QA.md).
//
// Copy arrives already translated from JS — the whole i18n bundle lives
// there, and duplicating it into NSLocalizedString would be a second
// translation source to keep in sync.
struct BlocklistPickerHostView: View {
  @State private var selection: FamilyActivitySelection
  private let headerText: String
  private let footerText: String
  private let onDone: (FamilyActivitySelection?) -> Void

  init(
    initialSelection: FamilyActivitySelection,
    headerText: String,
    footerText: String,
    onDone: @escaping (FamilyActivitySelection?) -> Void
  ) {
    _selection = State(initialValue: initialSelection)
    self.headerText = headerText
    self.footerText = footerText
    self.onDone = onDone
  }

  var body: some View {
    NavigationView {
      VStack(alignment: .leading, spacing: 8) {
        if !headerText.isEmpty {
          Text(headerText)
            .font(.subheadline)
            .padding(.horizontal)
            .padding(.top, 8)
            .fixedSize(horizontal: false, vertical: true)
        }

        FamilyActivityPicker(selection: $selection)

        if !footerText.isEmpty {
          Text(footerText)
            .font(.footnote)
            .foregroundColor(.secondary)
            .padding(.horizontal)
            .padding(.bottom, 8)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button(NSLocalizedString("activityPicker.cancel", comment: "Cancel button")) {
            onDone(nil)
          }
        }
        ToolbarItem(placement: .confirmationAction) {
          Button(NSLocalizedString("activityPicker.done", comment: "Done button")) {
            onDone(selection)
          }
        }
      }
    }
  }
}
