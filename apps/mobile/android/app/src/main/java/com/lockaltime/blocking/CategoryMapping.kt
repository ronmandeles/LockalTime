package com.lockaltime.blocking

import android.content.pm.ApplicationInfo

// Maps the JS-side locked category list (apps/mobile/src/config/blocked-categories.ts:
// 'social' | 'games' | 'entertainment') to Android's ApplicationInfo.CATEGORY_*
// constants (ARCHITECTURE.md §4). Android has no distinct "entertainment"
// category — apps in that space (streaming/media) are typically declared
// CATEGORY_VIDEO or CATEGORY_AUDIO, so 'entertainment' maps to both as the
// closest approximation. This is the same accepted limitation ARCHITECTURE.md
// §4 already documents: "Android's category field is inconsistently
// populated... may miss a small number of mislabeled apps."
object CategoryMapping {
  private val JS_TO_ANDROID: Map<String, Set<Int>> =
    mapOf(
      "social" to setOf(ApplicationInfo.CATEGORY_SOCIAL),
      "games" to setOf(ApplicationInfo.CATEGORY_GAME),
      "entertainment" to setOf(ApplicationInfo.CATEGORY_VIDEO, ApplicationInfo.CATEGORY_AUDIO),
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
