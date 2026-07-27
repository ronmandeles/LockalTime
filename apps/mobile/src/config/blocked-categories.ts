// Locked MVP blocked-category list (ARCHITECTURE.md §4, Phase 3 planning
// 2026-07-27 — see backlog.md). A fixed config constant, not user- or
// session-configurable: each platform maps these to its own native category
// enum (iOS FamilyControls ActivityCategoryToken / Android
// ApplicationInfo.category) at block-time. Single source of truth here, not
// duplicated per platform, so the list can change without a native rebuild —
// SessionBlockerConfig.blockedCategories (app-blocker.ts) is populated from
// this constant, never hardcoded again downstream.
export type BlockedCategory = 'social' | 'games' | 'entertainment';

export const BLOCKED_CATEGORIES: readonly BlockedCategory[] = ['social', 'games', 'entertainment'];
