// Apps that must never appear in the Create Session picker, whatever
// source it is reading through (docs/BLOCKLIST_SELECTION_PLAN.md §8).
//
// **This is a second copy of the server's SAFETY_DENYLIST**
// (apps/server/src/modules/sessions/blocklist.ts), and it has to be: the
// server cannot ship code to the client, and a client cannot be trusted to
// enforce it. The two are belt and braces for different failure modes —
// this one keeps a well-meaning host from picking their own dialer, the
// server's keeps a modified client from imposing it on anyone else. Neither
// makes the other redundant. Keep them in sync by hand; each side has a
// test pinning its own copy.
//
// Honest limit, same as the server's: the *default* dialer and SMS app are
// device-specific, so a static list only covers well-known identifiers. The
// device-accurate check is Android's TelecomManager/RoleManager, which
// InstalledAppsModule performs when it enumerates for real (task 4) — this
// list is what protects the catalog-backed source, which has no device to
// ask.
export const SAFETY_DENYLIST: readonly string[] = [
  // Dialer / telephony
  'com.android.dialer',
  'com.google.android.dialer',
  'com.samsung.android.dialer',
  'com.android.phone',
  'com.android.server.telecom',
  'com.apple.mobilephone',
  // Messaging
  'com.android.mms',
  'com.google.android.apps.messaging',
  'com.samsung.android.messaging',
  'com.apple.MobileSMS',
  // Settings and system shell — blocking these makes the block itself
  // unrecoverable from the device.
  'com.android.settings',
  'com.android.systemui',
  'com.apple.Preferences',
  // Ourselves. Emergency exit is the one thing that always has to work
  // (ARCHITECTURE.md §7) and it lives in this app.
  'com.lockaltime.app',
];

const DENIED = new Set(SAFETY_DENYLIST.map((packageName) => packageName.toLowerCase()));

export const isSafetyDenied = (packageName: string): boolean =>
  DENIED.has(packageName.toLowerCase());
