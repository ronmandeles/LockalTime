// The category vocabulary a host draws on when choosing what a session
// blocks (docs/BLOCKLIST_SELECTION_PLAN.md §1). Each platform maps these to
// its own native category enum (iOS FamilyControls ActivityCategoryToken /
// Android ApplicationInfo.category) at block time, so the list can change
// without a native rebuild.
//
// **Phase 9 reversed this file's original premise.** It used to say the
// three categories were "not user- or session-configurable" — a fixed
// config constant. They are now the *default* the picker pre-fills, not the
// enforced truth: the host chooses per session, and the choice travels on
// the session row (sessions.blocked_categories).
//
// This is the ONE JS-side declaration of the list. app-blocker.ts used to
// keep a second copy for its runtime bridge validation, which is exactly
// the duplication that punishes a change like three-to-six: missing the
// second copy would have made toBlockerEvent silently drop every event for
// the new categories. Kotlin necessarily keeps its own
// (android/.../CategoryMapping.kt) — the server keeps a third
// (apps/server/src/modules/sessions/blocklist.ts) because it is across a
// trust boundary — and both are pinned by their own tests.

export const BLOCKED_CATEGORY_VALUES = [
  'social',
  'games',
  'entertainment',
  'news',
  'maps',
  'productivity',
] as const;

export type BlockedCategory = (typeof BLOCKED_CATEGORY_VALUES)[number];

// What the Create Session picker pre-fills. Not an arbitrary choice: it is
// exactly what every session enforced before Phase 9, so existing habits
// are unchanged and the three new categories are opt-in. Matches the
// sessions.blocked_categories column default and the server's own
// DEFAULT_BLOCKED_CATEGORIES.
export const DEFAULT_BLOCKED_CATEGORIES: readonly BlockedCategory[] = [
  'social',
  'games',
  'entertainment',
];

export const isBlockedCategory = (value: unknown): value is BlockedCategory =>
  typeof value === 'string' && (BLOCKED_CATEGORY_VALUES as readonly string[]).includes(value);
