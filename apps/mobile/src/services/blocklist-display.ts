import { findCatalogApp, resolveAppName } from '../config/app-catalog';
import type { BlockedCategory } from '../config/blocked-categories';

// How a blocklist is described to someone who did not choose it — Screen 8
// before joining, Screen 6 during the session
// (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// Pure, and deliberately takes the category translator as a parameter
// instead of reaching for i18next: the *shape* of the description is
// testable on its own, and both screens get identical wording for free.
//
// Categories are translated; app names are not. Brands aren't localized, so
// "Instagram" reads as Instagram in the Hebrew UI — and the name is
// resolved from THIS device's catalog, never sent, so nothing a host typed
// ever renders on a stranger's phone (plan §6).

export const describeBlocklist = (
  categories: readonly BlockedCategory[],
  packages: readonly string[],
  translateCategory: (category: BlockedCategory) => string,
): readonly string[] => {
  const selectedCategories = new Set<string>(categories);

  // Plan §9: an app already covered by a selected category is dropped. It
  // is harmless for enforcement either way, but listing Instagram next to
  // Social makes the session look like it blocks more than it does, and
  // invites the reader to wonder what the difference between the two
  // entries is. An app we have never heard of has no known category, so
  // nothing can claim to cover it — those always stay listed.
  const uncoveredPackages = [...new Set(packages)].filter((packageName) => {
    const known = findCatalogApp(packageName);
    return known === undefined || !selectedCategories.has(known.category);
  });

  return [
    ...categories.map(translateCategory),
    ...uncoveredPackages.map((packageName) => resolveAppName(packageName)),
  ];
};
