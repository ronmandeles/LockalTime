import FamilyControls
import SwiftUI

// Phase 3 task 3.6: wraps FamilyControls' FamilyActivityPicker with explicit
// Cancel/Done chrome — the picker itself only exposes a live selection
// Binding, no "finished" callback, so this view is what turns "the user
// tapped Done" into a discrete result BlockingPermissionsModule can resolve
// its promise with. Presented once (during the Screen 2 permission-priming
// flow) since the resulting FamilyActivitySelection is persisted
// (SharedAppGroup) and reapplied on every session start — the user is never
// asked again unless they want to change categories later (not built yet;
// there's no "change blocked categories" entry point in the app today).
//
// NOT compiled or run anywhere in this repo (no Mac) — see
// SharedAppGroup.swift's header for the same caveat.
struct ActivityPickerHostView: View {
  @State private var selection: FamilyActivitySelection
  private let onDone: (FamilyActivitySelection?) -> Void

  init(initialSelection: FamilyActivitySelection, onDone: @escaping (FamilyActivitySelection?) -> Void) {
    _selection = State(initialValue: initialSelection)
    self.onDone = onDone
  }

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle(NSLocalizedString("activityPicker.title", comment: "Screen title for the category picker"))
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
