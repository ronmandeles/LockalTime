import { Linking, Platform } from 'react-native';

import { APP_CATALOG, type CatalogApp } from '../config/app-catalog';
import type { BlockedCategory } from '../config/blocked-categories';
import { isSafetyDenied } from '../config/blocklist-safety';
import { installedApps } from './installed-apps';

// The source the Create Session app picker reads through
// (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// **One list, both platforms.** The bundled catalog
// (src/config/app-catalog.json) is the fixed set of apps a host can name,
// on Android and iOS alike (owner decision 2026-08-08). Each platform then
// answers the same narrow question about each entry — *do you have this
// one?* — through whichever mechanism it offers:
//
//   * **iOS** — `canOpenURL`, against the schemes declared in Info.plist's
//     LSApplicationQueriesSchemes (capped by Apple at 50).
//   * **Android** — `InstalledAppsModule`, against the packages declared in
//     the manifest's <queries> block.
//
// Neither is a restricted permission, and neither can enumerate anything
// beyond the catalog. That is the whole point: Android used to enumerate the
// entire device via QUERY_ALL_PACKAGES, which made the two platforms
// materially different products AND carried a Play Console declaration that
// could be refused outright. Once the catalog is the only way to name an app
// anywhere, enumeration bought nothing but that risk.
//
// The honest cost, stated in docs/APP_CATALOG.md: an app outside the catalog
// cannot be named by anyone. Categories still cover the long tail — every
// game is covered by `games` whether or not we have heard of it — so a
// missing entry degrades to "use the category instead".

export type InstalledState =
  // Known present on this device.
  | 'installed'
  // Known absent — the platform was asked and said no.
  | 'not_installed'
  // Could not be determined, and this is a real, common answer rather than
  // a failure: iOS can only probe the ~50 declared schemes, and an Android
  // build without the native module can probe nothing. The UI must not read
  // 'unknown' as 'not_installed' — an app the host lacks is a harmless
  // no-op for them and still blocks correctly for members who have it.
  | 'unknown';

export interface BlockableApp {
  // The package name — the cross-device identity, and the only field ever
  // sent anywhere.
  readonly id: string;
  readonly name: string;
  readonly category: BlockedCategory;
  readonly installed: InstalledState;
}

export interface BlockableAppSource {
  listApps(): Promise<readonly BlockableApp[]>;
}

const visibleCatalog = (): readonly CatalogApp[] =>
  APP_CATALOG.filter((app) => !isSafetyDenied(app.id));

// iOS offers no enumeration, but it does answer one narrow question per
// app. Each scheme must be declared in Info.plist, and Apple caps that at
// 50 — twenty questions, not a directory listing.
//
// A rejected probe resolves to 'unknown', never 'not_installed': the most
// likely cause is a scheme missing from Info.plist, which says nothing about
// whether the app is there. Guessing 'not_installed' would hide the entry
// from a host who has it.
const probeIos = async (app: CatalogApp): Promise<InstalledState> => {
  if (app.iosScheme === undefined) {
    return 'unknown';
  }
  try {
    return (await Linking.canOpenURL(`${app.iosScheme}://`)) ? 'installed' : 'not_installed';
  } catch {
    return 'unknown';
  }
};

const listForIos = async (catalog: readonly CatalogApp[]): Promise<readonly BlockableApp[]> => {
  const states = await Promise.all(catalog.map(probeIos));
  return catalog.map((app, index) => ({
    id: app.id,
    name: app.name,
    category: app.category,
    installed: states[index] ?? 'unknown',
  }));
};

const listForAndroid = async (catalog: readonly CatalogApp[]): Promise<readonly BlockableApp[]> => {
  const installed = await installedApps.getInstalledPackages(catalog.map((app) => app.id));

  return catalog.map((app) => ({
    id: app.id,
    name: app.name,
    category: app.category,
    // null means the question could not be asked — no native module, or a
    // bridge failure. That is 'unknown' for every entry, never
    // 'not_installed': claiming absence we did not observe would hide apps
    // the host actually has, which is the one thing this filtering must not
    // do.
    installed:
      installed === null
        ? ('unknown' as const)
        : installed.has(app.id)
          ? ('installed' as const)
          : ('not_installed' as const),
  }));
};

export const blockableAppSource: BlockableAppSource = {
  async listApps(): Promise<readonly BlockableApp[]> {
    const catalog = visibleCatalog();
    return Platform.OS === 'ios' ? listForIos(catalog) : listForAndroid(catalog);
  },
};
