// The vocabulary a host draws on when naming what a session blocks
// (docs/BLOCKLIST_SELECTION_PLAN.md §1/§4), plus the two rejections the
// server performs that do not depend on the client behaving.
//
// Kept as its own module rather than inlined in the router because all of
// it is pure and every part of it is a decision worth testing directly: the
// category vocabulary has to stay in lockstep with a DB CHECK constraint no
// compiler connects it to, and the two find* functions below are the
// server's half of "the picker filtered this out" — the half that still
// works against a modified client.

export const BLOCKED_CATEGORIES = [
  'social',
  'games',
  'entertainment',
  'news',
  'maps',
  'productivity',
] as const;

export type BlockedCategory = (typeof BLOCKED_CATEGORIES)[number];

// What the picker pre-fills and what a request omitting a blocklist gets.
// Not an arbitrary default: it is exactly what every session enforced
// before this feature existed (apps/mobile/src/config/blocked-categories.ts,
// and the sessions.blocked_categories column default), so existing habits
// are unchanged and the three new categories are opt-in.
export const DEFAULT_BLOCKED_CATEGORIES: readonly BlockedCategory[] = [
  'social',
  'games',
  'entertainment',
];

// Owner decision 2026-08-07 (plan §4): pattern-match rather than
// catalog-only. The string is never executed, never a path, never
// interpolated into SQL — it is only ever compared against a package name
// on-device — so the injection surface is nil, and catalog-only would cap
// Android hosts at catalog apps. The real risk is a host blocking someone's
// phone app, which SAFETY_DENYLIST below addresses directly.
export const PACKAGE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

// Never blockable, whatever the client sends. Belt and braces, not a
// complete guarantee, and the plan is explicit about why: the *default*
// dialer and SMS app are device-specific, so the server can only cover
// well-known identifiers and the device-accurate check (TelecomManager,
// RoleManager) stays client-side in the picker. What this does guarantee is
// that the common case cannot be reached by a modified client at all.
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

export interface Blocklist {
  readonly categories: readonly BlockedCategory[];
  readonly packages: readonly string[];
}

const DENIED = new Set(SAFETY_DENYLIST.map((packageName) => packageName.toLowerCase()));

// Case-insensitive: a cased variant would never match a real package
// on-device anyway, but normalizing costs nothing and removes the question.
export const findDeniedPackages = (packages: readonly string[]): readonly string[] =>
  packages.filter((packageName) => DENIED.has(packageName.toLowerCase()));

// Every entry of `requested` that the venue was not approved for, in the
// order the host sent them — categories first, then packages. Returns all
// of them rather than the first, so the rejection can name the whole
// problem instead of making the caller fix it one entry at a time.
export const findUnapprovedEntries = (
  requested: Blocklist,
  approved: Blocklist,
): readonly string[] => {
  const approvedCategories = new Set<string>(approved.categories);
  const approvedPackages = new Set<string>(approved.packages);

  return [
    ...requested.categories.filter((category) => !approvedCategories.has(category)),
    ...requested.packages.filter((packageName) => !approvedPackages.has(packageName)),
  ];
};
