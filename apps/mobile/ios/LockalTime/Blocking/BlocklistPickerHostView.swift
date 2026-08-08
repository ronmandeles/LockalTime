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
// The header and footer carry that list into Apple's own sheet, which is the
// one thing that meaningfully reduces the friction: the member isn't working
// from memory of the previous screen while using Apple's search field.
// Roughly 15-20 seconds for three items. Android members skip all of it.
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
      FamilyActivityPicker(
        headerText: headerText,
        footerText: footerText,
        selection: $selection
      )
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
