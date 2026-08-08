import catalogData from './app-catalog.json';
import { isBlockedCategory, type BlockedCategory } from './blocked-categories';

// The bundled catalog of well-known apps: package name plus display name,
// one JSON file, no permissions (docs/BLOCKLIST_SELECTION_PLAN.md §6,
// docs/APP_CATALOG.md). It does three jobs, in descending order of
// importance:
//
//   1. It is the ONLY way an iOS host can name a specific app at all.
//      Apple's picker hands back opaque tokens that cannot be read into a
//      bundle id or moved between devices, so a host who chooses there has
//      nothing to write into blocked_packages. Picking "Instagram" from
//      this list stores com.instagram.android, which travels normally.
//   2. It keeps host-supplied text off other people's screens. It would be
//      easy to send { id, label } so members see "Instagram" rather than a
//      package name — DON'T. That is host-controlled text rendered on
//      strangers' phones, and a venue session seats up to 200 of them. The
//      wire format is package names only; the receiving device resolves the
//      display name from its own copy, here.
//   3. It is the fallback if Google refuses QUERY_ALL_PACKAGES (§10).
//
// The `id` is the Android package name on BOTH platforms. That is not an
// Android bias — it is simply the one identifier that means the same thing
// on every device, which is the entire requirement.
//
// App names deliberately stay in English and never go through i18next:
// brands aren't localized, so "Instagram" reads as Instagram in the Hebrew
// UI. Only category names are translated.

export interface CatalogApp {
  // The cross-device identity, and the Android package name.
  readonly id: string;
  // Display only, resolved locally — never sent anywhere.
  readonly name: string;
  readonly category: BlockedCategory;
  // Present only where the scheme is well-documented and stable. A WRONG
  // scheme is worse than a missing one: canOpenURL would return false and
  // the entry would be hidden from a host who genuinely has the app, so
  // most entries carry none on purpose (docs/APP_CATALOG.md).
  readonly iosScheme?: string;
}

interface RawCatalogEntry {
  id: string;
  name: string;
  category: string;
  iosScheme?: string;
}

// Boundary validation on data loaded from a file, same posture as the
// native-bridge payloads in app-blocker.ts: a malformed row is dropped
// rather than trusted or thrown on. The integrity test
// (app-catalog.test.ts) is what makes the drop path unreachable in
// practice — this is the guard that keeps a bad hand-edit from crashing
// the picker at runtime, and the test is what stops one shipping.
const toCatalogApp = (raw: RawCatalogEntry): CatalogApp | null => {
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    return null;
  }
  if (typeof raw.name !== 'string' || raw.name.trim().length === 0) {
    return null;
  }
  if (!isBlockedCategory(raw.category)) {
    return null;
  }
  return raw.iosScheme === undefined
    ? { id: raw.id, name: raw.name, category: raw.category }
    : { id: raw.id, name: raw.name, category: raw.category, iosScheme: raw.iosScheme };
};

export const APP_CATALOG: readonly CatalogApp[] = (catalogData as RawCatalogEntry[]).flatMap(
  (raw) => {
    const app = toCatalogApp(raw);
    return app === null ? [] : [app];
  },
);

// Apple's hard cap on Info.plist's LSApplicationQueriesSchemes. Exceeding
// it doesn't degrade — the array stops working — so the integrity test
// treats this as a bound to stay under, with headroom, not a target to
// fill.
export const IOS_QUERY_SCHEME_LIMIT = 50;

// Exactly what belongs in Info.plist's LSApplicationQueriesSchemes. Derived
// from the catalog rather than maintained beside it, so the two can never
// drift.
export const IOS_APPLICATION_QUERIES_SCHEMES: readonly string[] = APP_CATALOG.flatMap((app) =>
  app.iosScheme === undefined ? [] : [app.iosScheme],
);

const BY_ID = new Map(APP_CATALOG.map((app) => [app.id, app]));

export const findCatalogApp = (packageName: string): CatalogApp | undefined =>
  BY_ID.get(packageName);

// The raw package name is the fallback, deliberately. It is unlovely but
// it is honest, and it is always safe: it is a string this device chose to
// render, not one a host typed.
export const resolveAppName = (packageName: string): string =>
  BY_ID.get(packageName)?.name ?? packageName;
