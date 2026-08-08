import {
  BLOCKED_CATEGORIES,
  DEFAULT_BLOCKED_CATEGORIES,
  PACKAGE_NAME_PATTERN,
  SAFETY_DENYLIST,
  findDeniedPackages,
  findUnapprovedEntries,
} from './blocklist';

describe('the blocklist vocabulary', () => {
  it('is exactly the six categories the DB CHECK constraint accepts', () => {
    // Deliberately spelled out rather than derived: this array and
    // chk_blocked_categories_valid (20260807000000) are two copies of one
    // decision that no compiler connects, so the test is the connection.
    expect([...BLOCKED_CATEGORIES]).toEqual([
      'social',
      'games',
      'entertainment',
      'news',
      'maps',
      'productivity',
    ]);
  });

  it('defaults to the three categories every pre-existing session already enforced', () => {
    expect([...DEFAULT_BLOCKED_CATEGORIES]).toEqual(['social', 'games', 'entertainment']);
  });

  it('only defaults to categories that are themselves valid', () => {
    DEFAULT_BLOCKED_CATEGORIES.forEach((category) => {
      expect(BLOCKED_CATEGORIES).toContain(category);
    });
  });
});

describe('PACKAGE_NAME_PATTERN', () => {
  it.each([
    'com.instagram.android',
    'com.zhiliaoapp.musically',
    'com.google.android.youtube',
    'org.telegram.messenger',
    'a.b',
    'com.example._underscored',
  ])('accepts the well-formed package name %s', (packageName) => {
    expect(PACKAGE_NAME_PATTERN.test(packageName)).toBe(true);
  });

  it.each([
    ['instagram', 'a bare word with no dot is not a package name'],
    ['com.', 'a trailing dot leaves an empty segment'],
    ['.com.instagram', 'a leading dot leaves an empty segment'],
    ['com..instagram', 'an empty middle segment'],
    ['1com.instagram', 'a segment may not start with a digit'],
    ['com.instagram android', 'whitespace is never part of a package name'],
    ['com.instagram-android', 'a hyphen is not a legal package-name character'],
    ["com.instagram'; drop table sessions--", 'a SQL-shaped payload'],
    ['<script>alert(1)</script>', 'an HTML-shaped payload'],
    ['', 'the empty string'],
  ])('rejects %s — %s', (packageName) => {
    expect(PACKAGE_NAME_PATTERN.test(packageName)).toBe(false);
  });
});

describe('findDeniedPackages', () => {
  it('finds nothing in an ordinary blocklist', () => {
    expect(findDeniedPackages(['com.instagram.android', 'com.zhiliaoapp.musically'])).toEqual([]);
  });

  it('refuses a well-known dialer, so nobody is cut off from calling anyone', () => {
    expect(findDeniedPackages(['com.google.android.dialer'])).toEqual([
      'com.google.android.dialer',
    ]);
  });

  it('refuses the messaging and settings apps too', () => {
    expect(
      findDeniedPackages(['com.google.android.apps.messaging', 'com.android.settings']),
    ).toEqual(['com.google.android.apps.messaging', 'com.android.settings']);
  });

  it('refuses our own package — a host cannot lock anyone out of leaving the session', () => {
    expect(findDeniedPackages(['com.lockaltime.app'])).toEqual(['com.lockaltime.app']);
  });

  it('is case-insensitive, so a cased variant is not a way around the list', () => {
    expect(findDeniedPackages(['COM.Android.Settings'])).toEqual(['COM.Android.Settings']);
  });

  it('reports only the denied entries, leaving legitimate ones alone', () => {
    expect(
      findDeniedPackages(['com.instagram.android', 'com.android.phone', 'com.reddit.frontpage']),
    ).toEqual(['com.android.phone']);
  });

  it('holds nothing that is not a well-formed package name itself', () => {
    SAFETY_DENYLIST.forEach((packageName) => {
      expect(PACKAGE_NAME_PATTERN.test(packageName)).toBe(true);
    });
  });
});

describe('findUnapprovedEntries', () => {
  const approved = {
    categories: ['social', 'games'] as const,
    packages: ['com.instagram.android'] as const,
  };

  it("accepts a blocklist that is exactly the venue's approved set", () => {
    expect(
      findUnapprovedEntries(
        { categories: ['social', 'games'], packages: ['com.instagram.android'] },
        approved,
      ),
    ).toEqual([]);
  });

  it('accepts a proper subset — a venue may always block less than it is approved for', () => {
    expect(findUnapprovedEntries({ categories: ['social'], packages: [] }, approved)).toEqual([]);
  });

  it('rejects a category the venue was never approved for', () => {
    expect(
      findUnapprovedEntries({ categories: ['social', 'news'], packages: [] }, approved),
    ).toEqual(['news']);
  });

  it('rejects an app the venue was never approved for — a cafe cannot block a competitor', () => {
    expect(
      findUnapprovedEntries({ categories: [], packages: ['com.competitor.app'] }, approved),
    ).toEqual(['com.competitor.app']);
  });

  it('reports every unapproved entry at once, not just the first', () => {
    expect(
      findUnapprovedEntries(
        { categories: ['maps'], packages: ['com.competitor.app', 'com.other.app'] },
        approved,
      ),
    ).toEqual(['maps', 'com.competitor.app', 'com.other.app']);
  });

  it('rejects everything when the venue is approved for nothing at all', () => {
    expect(
      findUnapprovedEntries(
        { categories: ['social'], packages: [] },
        { categories: [], packages: [] },
      ),
    ).toEqual(['social']);
  });
});
