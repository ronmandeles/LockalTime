import { BLOCKED_CATEGORY_VALUES } from './blocked-categories';
import {
  APP_CATALOG,
  IOS_APPLICATION_QUERIES_SCHEMES,
  IOS_QUERY_SCHEME_LIMIT,
  findCatalogApp,
  resolveAppName,
} from './app-catalog';
import { SAFETY_DENYLIST } from './blocklist-safety';

// The catalog is DATA, shipped from a JSON file with no code in it
// (docs/APP_CATALOG.md). Nothing on this machine can check whether
// `com.wbd.stream` is really HBO Max — that is a real-device pass, in
// docs/MANUAL_QA.md. What IS checkable is every structural property the
// rest of the feature relies on, and each of these guards a failure that
// would otherwise be silent: a duplicate id double-lists an app in the
// picker, a malformed package name is rejected by the server's own regex
// at create time, and a 51st URL scheme makes iOS reject the Info.plist
// outright.

// Same pattern the server validates against
// (apps/server/src/modules/sessions/blocklist.ts). Duplicated across the
// trust boundary because it must be — the server cannot ship code to the
// client — so this test is what keeps the catalog inside what the API
// will actually accept.
const PACKAGE_NAME_PATTERN = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$/;

describe('the app catalog as data', () => {
  it('is a non-trivial list — a nearly-empty catalog would silently make the iOS host picker useless', () => {
    expect(APP_CATALOG.length).toBeGreaterThanOrEqual(50);
  });

  it('has no duplicate ids', () => {
    const ids = APP_CATALOG.map((app) => app.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has no duplicate display names either — two rows reading "Instagram" is a picker bug', () => {
    const names = APP_CATALOG.map((app) => app.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every entry an id the server will accept as a package name', () => {
    const malformed = APP_CATALOG.filter((app) => !PACKAGE_NAME_PATTERN.test(app.id));
    expect(malformed).toEqual([]);
  });

  it('gives every entry one of the six categories', () => {
    const wrong = APP_CATALOG.filter(
      (app) => !(BLOCKED_CATEGORY_VALUES as readonly string[]).includes(app.category),
    );
    expect(wrong).toEqual([]);
  });

  it('gives every entry a non-empty display name', () => {
    expect(APP_CATALOG.filter((app) => app.name.trim().length === 0)).toEqual([]);
  });

  it('never offers an app on the safety denylist', () => {
    const denied = APP_CATALOG.filter((app) =>
      (SAFETY_DENYLIST as readonly string[]).includes(app.id),
    );
    expect(denied).toEqual([]);
  });

  // docs/APP_CATALOG.md's selection rule, asserted rather than left as
  // prose: categories already handle the long tail, so the catalog only
  // earns its place where "block the whole category" is too blunt — which
  // in practice is social.
  it('is weighted toward social, which is the whole reason it exists', () => {
    const counts = new Map<string, number>();
    APP_CATALOG.forEach((app) => counts.set(app.category, (counts.get(app.category) ?? 0) + 1));
    const social = counts.get('social') ?? 0;
    const largestOther = Math.max(
      ...[...counts.entries()].filter(([category]) => category !== 'social').map(([, n]) => n),
    );
    expect(social).toBeGreaterThan(largestOther);
  });
});

describe('IOS_APPLICATION_QUERIES_SCHEMES', () => {
  it('stays within the cap Apple enforces on LSApplicationQueriesSchemes', () => {
    expect(IOS_APPLICATION_QUERIES_SCHEMES.length).toBeLessThanOrEqual(IOS_QUERY_SCHEME_LIMIT);
  });

  it('is exactly the distinct schemes the catalog declares, in catalog order', () => {
    const fromCatalog = APP_CATALOG.flatMap((app) =>
      app.iosScheme === undefined ? [] : [app.iosScheme],
    );
    expect([...IOS_APPLICATION_QUERIES_SCHEMES]).toEqual(fromCatalog);
  });

  it('has no duplicates — a repeated entry wastes one of the 50 slots', () => {
    expect(new Set(IOS_APPLICATION_QUERIES_SCHEMES).size).toBe(
      IOS_APPLICATION_QUERIES_SCHEMES.length,
    );
  });

  it('holds bare scheme names, never a full URL', () => {
    const withPunctuation = IOS_APPLICATION_QUERIES_SCHEMES.filter(
      (scheme) => scheme.includes(':') || scheme.includes('/'),
    );
    expect(withPunctuation).toEqual([]);
  });
});

describe('findCatalogApp', () => {
  it('finds a known app by its package name', () => {
    expect(findCatalogApp('com.instagram.android')).toMatchObject({
      id: 'com.instagram.android',
      name: 'Instagram',
      category: 'social',
    });
  });

  it('returns undefined for a package it has never heard of', () => {
    expect(findCatalogApp('com.some.unknown.app')).toBeUndefined();
  });
});

describe('resolveAppName', () => {
  // The wire format is package names only, precisely so that nothing a
  // host types ever renders on a stranger's phone (plan §6). The receiving
  // device resolves the display name from its OWN copy of the catalog.
  it('resolves a catalog package to its display name', () => {
    expect(resolveAppName('com.zhiliaoapp.musically')).toBe('TikTok');
  });

  it('falls back to the raw package name for anything unknown', () => {
    expect(resolveAppName('com.some.unknown.app')).toBe('com.some.unknown.app');
  });

  it('never renders anything but the package name for an unknown entry, even a hostile one', () => {
    expect(resolveAppName('com.evil.<script>')).toBe('com.evil.<script>');
  });
});
