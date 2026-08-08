import type { BlockedCategory } from '../config/blocked-categories';

// The rule that decides how an iOS member acquires the tokens for a
// session's blocklist (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// **Why any of this exists.** Apple's ApplicationToken cannot be built from
// a bundle id, read back into one, or moved between devices — so a package
// name arriving from our server has nothing to bind to on an iPhone. The
// member re-selects the session's items in Apple's own picker. The tokens
// are opaque but Hashable, which is enough for set arithmetic to learn
// which token is which without ever asking the user to tag anything:
// present the picker pre-seeded with what we already know, and whatever
// they add is, by subtraction, the one item we didn't have.
//
// **Why the rule is in JS and not Swift.** The map of id -> token must live
// in Swift, since tokens cannot cross the bridge. The RULE must not: it is
// the subtlest logic in this feature, Swift is the one place this project
// cannot test (no Mac, §12), and a bug in it is silent, permanent, and
// invisible until someone earns points with nothing blocked. So the native
// module exposes the map's KEYS only, JS decides, and Swift stays a dumb
// keyed store with no branching to get wrong.

export type SelectionStrategy =
  // Every item is already in the map. Compose the selection from it and
  // never show the picker at all.
  | { readonly kind: 'compose_from_known'; readonly ids: readonly string[] }
  // Exactly one unknown. Pre-seed the picker with the known tokens and name
  // the missing one in the header; whatever the user adds is that item's
  // token, by subtraction. Learn it.
  | {
      readonly kind: 'learn_one';
      readonly knownIds: readonly string[];
      readonly unknownId: string;
    }
  // Two or more unknown. Present the whole list and learn nothing — the
  // difference would be a set of two tokens with no way to tell which is
  // which, and guessing would poison the map permanently and undetectably.
  // The per-combination cache is what keeps this from repeating.
  | { readonly kind: 'present_full_picker'; readonly ids: readonly string[] };

// Categories and packages share one id space because Apple's picker treats
// them the same way: both are opaque tokens the user selects, and the
// subtraction that learns one works identically on either.
export const blocklistIds = (
  categories: readonly BlockedCategory[],
  packages: readonly string[],
): readonly string[] => [...categories, ...packages];

// Keyed on the WHOLE blocklist (plan §7): [social, instagram] reuses a
// saved selection, while [social, instagram, tiktok] is a different key and
// re-prompts. That is the point — a cached selection is only sound for the
// exact set it was made for.
//
// Sorted, because order is not meaningful in a blocklist and a spurious
// cache miss costs the member a picker round they already did. The two
// lists are kept in separate segments so a category can never collide with
// a package that happens to share its name.
export const blocklistCacheKey = (
  categories: readonly BlockedCategory[],
  packages: readonly string[],
): string => `c:${[...categories].sort().join(',')}|p:${[...packages].sort().join(',')}`;

export const decideSelectionStrategy = (
  ids: readonly string[],
  knownIds: readonly string[],
): SelectionStrategy => {
  const known = new Set(knownIds);
  // De-duplicated first, so a repeated id can never be counted as a second
  // unknown and push an otherwise-learnable session into the full picker.
  const wanted = [...new Set(ids)];
  const unknown = wanted.filter((id) => !known.has(id));

  if (unknown.length === 0) {
    return { kind: 'compose_from_known', ids: wanted };
  }
  if (unknown.length === 1) {
    return {
      kind: 'learn_one',
      knownIds: wanted.filter((id) => known.has(id)),
      unknownId: unknown[0] as string,
    };
  }
  return { kind: 'present_full_picker', ids: wanted };
};
