import { describeBlocklist } from './blocklist-display';

// How a blocklist is described to someone who did not choose it — Screen 8
// before joining, Screen 6 during the session
// (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// Pure, and it takes the category translator as a parameter rather than
// reaching for i18next, so every case here is about the *content* of the
// description rather than about rendering.

// Stand-in for t('createSession.blocklist.category.<x>').
const translateCategory = (category: string): string =>
  ({
    social: 'Social',
    games: 'Games',
    entertainment: 'Entertainment',
    news: 'News',
    maps: 'Maps',
    productivity: 'Work',
  })[category] ?? category;

describe('describeBlocklist', () => {
  it('names categories in their translated form', () => {
    expect(describeBlocklist(['social', 'news'], [], translateCategory)).toEqual([
      'Social',
      'News',
    ]);
  });

  // Brands are not localized: the receiving device resolves the name from
  // its own catalog copy, and nothing a host typed ever travels (plan §6).
  it('resolves a catalog package to its English app name', () => {
    expect(describeBlocklist([], ['com.instagram.android'], translateCategory)).toEqual([
      'Instagram',
    ]);
  });

  it('falls back to the raw package name for an app it has never heard of', () => {
    expect(describeBlocklist([], ['com.niche.app'], translateCategory)).toEqual(['com.niche.app']);
  });

  it('lists categories before specific apps', () => {
    expect(describeBlocklist(['news'], ['com.instagram.android'], translateCategory)).toEqual([
      'News',
      'Instagram',
    ]);
  });

  // Plan §9: pick `social` AND Instagram, and Instagram is in both.
  // Harmless for enforcement — but listing it twice makes the session look
  // like it blocks more than it does, and invites the reader to wonder what
  // the difference is.
  it('omits an app already covered by a selected category', () => {
    expect(
      describeBlocklist(['social'], ['com.instagram.android'], translateCategory),
    ).toEqual(['Social']);
  });

  it('keeps an app whose category was NOT selected', () => {
    expect(describeBlocklist(['games'], ['com.instagram.android'], translateCategory)).toEqual([
      'Games',
      'Instagram',
    ]);
  });

  // An app we have never heard of has no known category, so nothing can
  // claim to cover it — listing it is the only honest option.
  it('keeps an unknown app even when categories are selected', () => {
    expect(describeBlocklist(['social'], ['com.niche.app'], translateCategory)).toEqual([
      'Social',
      'com.niche.app',
    ]);
  });

  it('de-duplicates a package listed twice', () => {
    expect(
      describeBlocklist([], ['com.instagram.android', 'com.instagram.android'], translateCategory),
    ).toEqual(['Instagram']);
  });

  it('describes an empty blocklist as nothing at all, rather than inventing a default', () => {
    expect(describeBlocklist([], [], translateCategory)).toEqual([]);
  });
});
