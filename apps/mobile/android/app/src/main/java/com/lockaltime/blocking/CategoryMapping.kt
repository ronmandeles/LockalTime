package com.lockaltime.blocking

import android.content.pm.ApplicationInfo

// Maps the JS-side category vocabulary (apps/mobile/src/config/
// blocked-categories.ts) to Android's ApplicationInfo.CATEGORY_* constants
// (ARCHITECTURE.md §4).
//
// **This is a third copy of that vocabulary** — JS has one declaration, the
// Node API has another across the trust boundary, and Kotlin necessarily
// keeps this one. Nothing connects them at compile time, which is exactly
// what made going from three categories to six (Phase 9) the change that
// punishes the duplication: miss a copy and the new categories are silently
// enforced by nobody. The JS pair was collapsed into one import in task 3;
// this one cannot be, so it is pinned by CategoryMappingTest instead.
//
// Android has no distinct "entertainment" category — apps in that space
// (streaming/media) are typically declared CATEGORY_VIDEO or CATEGORY_AUDIO,
// so 'entertainment' maps to both as the closest approximation. Same
// accepted limitation ARCHITECTURE.md §4 already documents: "Android's
// category field is inconsistently populated... may miss a small number of
// mislabeled apps."
//
// CATEGORY_IMAGE is deliberately unmapped — photo apps are not a distraction
// class worth a picker row — and CATEGORY_ACCESSIBILITY must NEVER be
// blockable.
object CategoryMapping {
  private val JS_TO_ANDROID: Map<String, Set<Int>> =
    mapOf(
      "social" to setOf(ApplicationInfo.CATEGORY_SOCIAL),
      "games" to setOf(ApplicationInfo.CATEGORY_GAME),
      "entertainment" to setOf(ApplicationInfo.CATEGORY_VIDEO, ApplicationInfo.CATEGORY_AUDIO),
      "news" to setOf(ApplicationInfo.CATEGORY_NEWS),
      "maps" to setOf(ApplicationInfo.CATEGORY_MAPS),
      "productivity" to setOf(ApplicationInfo.CATEGORY_PRODUCTIVITY),
    )

  fun androidCategoriesFor(jsCategory: String): Set<Int> = JS_TO_ANDROID[jsCategory] ?: emptySet()

  // Reverse lookup for event payloads (shield_triggered's `category` field
  // expects a JS BlockedCategory string, not Android's int constant). Falls
  // back to the first JS category whose Android set contains this value;
  // 'entertainment' wins over nothing since both its Android categories are
  // exclusively its own (no overlap with 'social'/'games').
  fun jsCategoryFor(androidCategory: Int): String? =
    JS_TO_ANDROID.entries.firstOrNull { (_, androidCategories) -> androidCategory in androidCategories }?.key
}
