import {
  blocklistCacheKey,
  blocklistIds,
  decideSelectionStrategy,
} from './ios-blocklist-selection';

// The rule that decides how an iOS member acquires the tokens for a
// session's blocklist (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// **This lives in JS on purpose, and this file is the reason.** Apple's
// tokens are opaque but Hashable, so set arithmetic learns which token is
// which without ever asking the user to tag anything — and that is the
// subtlest logic in the whole feature. Swift is the one place this project
// cannot test (no Mac, §12), and a bug here is silent, permanent, and
// invisible until someone earns points with nothing blocked. So Swift is
// reduced to a keyed store with no branching, and the branching is here,
// as a pure function over three inputs.

describe('blocklistIds', () => {
  // Categories and packages share one id space here because Apple's picker
  // treats them the same way: both are opaque tokens the user selects, and
  // the subtraction that learns one works identically on either.
  it('is the categories followed by the packages', () => {
    expect(blocklistIds(['social', 'news'], ['com.instagram.android'])).toEqual([
      'social',
      'news',
      'com.instagram.android',
    ]);
  });
});

describe('blocklistCacheKey', () => {
  it('is stable for the same blocklist', () => {
    expect(blocklistCacheKey(['social'], ['com.instagram.android'])).toBe(
      blocklistCacheKey(['social'], ['com.instagram.android']),
    );
  });

  // Order is not meaningful in a blocklist, and a spurious cache miss costs
  // the member a picker round they already did.
  it('ignores the order the host happened to pick things in', () => {
    expect(blocklistCacheKey(['news', 'social'], ['b.b.b', 'a.a.a'])).toBe(
      blocklistCacheKey(['social', 'news'], ['a.a.a', 'b.b.b']),
    );
  });

  // Plan §7: the cache is keyed on the WHOLE blocklist, so adding one app
  // is a different key and re-prompts. That is the point — a cached
  // selection is only sound for the exact set it was made for.
  it('differs once anything is added', () => {
    expect(blocklistCacheKey(['social'], ['com.instagram.android'])).not.toBe(
      blocklistCacheKey(['social'], ['com.instagram.android', 'com.zhiliaoapp.musically']),
    );
  });

  it('does not confuse a category with a package of the same name', () => {
    expect(blocklistCacheKey(['social'], [])).not.toBe(blocklistCacheKey([], ['social']));
  });
});

describe('decideSelectionStrategy', () => {
  it('composes from the map with no picker when every item is already known', () => {
    expect(
      decideSelectionStrategy(['social', 'com.instagram.android'], [
        'com.instagram.android',
        'social',
        'games',
      ]),
    ).toEqual({ kind: 'compose_from_known', ids: ['social', 'com.instagram.android'] });
  });

  it('pre-seeds the picker and learns when exactly one item is unknown', () => {
    expect(
      decideSelectionStrategy(['social', 'com.instagram.android'], ['social']),
    ).toEqual({
      kind: 'learn_one',
      knownIds: ['social'],
      unknownId: 'com.instagram.android',
    });
  });

  // The one-unknown restriction is a CORRECTNESS requirement, not caution.
  // With two unknowns the difference between the old and new selections is
  // a set of two tokens with no way to tell which is which — guessing would
  // poison the map permanently, and undetectably.
  it('refuses to learn when two items are unknown, and presents the whole list instead', () => {
    expect(decideSelectionStrategy(['social', 'news', 'com.instagram.android'], ['social'])).toEqual(
      {
        kind: 'present_full_picker',
        ids: ['social', 'news', 'com.instagram.android'],
      },
    );
  });

  it('presents the whole list when nothing at all is known', () => {
    expect(decideSelectionStrategy(['social', 'news'], [])).toEqual({
      kind: 'present_full_picker',
      ids: ['social', 'news'],
    });
  });

  it('learns the single item when the map is empty and the blocklist has exactly one entry', () => {
    expect(decideSelectionStrategy(['social'], [])).toEqual({
      kind: 'learn_one',
      knownIds: [],
      unknownId: 'social',
    });
  });

  // Once an app is in the map it is never asked for again, in any
  // combination — that is what makes the map fill up naturally as people
  // add one app at a time.
  it('composes from a map that knows far more than this session needs', () => {
    expect(
      decideSelectionStrategy(['social'], ['social', 'games', 'news', 'com.instagram.android']),
    ).toEqual({ kind: 'compose_from_known', ids: ['social'] });
  });

  it('treats an empty blocklist as nothing to do', () => {
    expect(decideSelectionStrategy([], ['social'])).toEqual({
      kind: 'compose_from_known',
      ids: [],
    });
  });

  it('ignores a duplicate id rather than counting it as a second unknown', () => {
    expect(
      decideSelectionStrategy(['com.instagram.android', 'com.instagram.android'], []),
    ).toEqual({
      kind: 'learn_one',
      knownIds: [],
      unknownId: 'com.instagram.android',
    });
  });
});
