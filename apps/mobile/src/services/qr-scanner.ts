// Shared type contract for "how ScanScreen obtains a QR token" — deliberately
// NOT a callable scan() function. Camera-based scanning needs
// react-native-vision-camera, a native module requiring Pod/Gradle linking
// this machine cannot install-and-verify (no Mac, no Android SDK platforms —
// the same standing constraint as every other native module in this repo).
// Adding an unverifiable native dependency now would leave the build in an
// unconfirmed state; a real camera adapter is deferred to Phase 3 (native
// blocker bridge), which already carries a manual-QA-pending native-module
// posture — see docs/MANUAL_QA.md.
//
// For Phase 2, ScanScreen constructs a ScanResult directly from a manual
// text-entry field (its own UI, not this module) — that's also what makes
// the join flow exercisable on this machine at all. When the camera adapter
// lands, it produces the same ScanResult shape from a decoded QR frame
// instead of a text field; nothing downstream (ScanScreen's join call)
// needs to change.
export interface ScanResult {
  readonly token: string;
}
