import { Linking, Platform } from 'react-native';

import { APP_CATALOG, type CatalogApp } from '../config/app-catalog';
import type { BlockedCategory } from '../config/blocked-categories';
import { isSafetyDenied } from '../config/blocklist-safety';

// The source seam the Create Session app picker reads through
// (docs/BLOCKLIST_SELECTION_PLAN.md §7). One component, two platforms:
//
//   * **Android** — the host's actually-installed apps, via
//     InstalledAppsModule (task 4). Not wired yet.
//   * **iOS** — the bundled catalog, filtered by canOpenURL probing so it
//     reads as the host's own apps rather than a list of popular ones.
//
// The seam also doubles as the QUERY_ALL_PACKAGES mitigation (§10): if
// Google refuses the restricted-permission declaration, Android points at
// the same catalog source iOS already uses. That is a one-line change here
// and no UI change at all — which is the whole reason the picker reads
// through an interface instead of calling a native module directly.

export type InstalledState =
  // Known present on this device.
  | 'installed'
  // Known absent. Only ever asserted where we genuinely asked.
  | 'not_installed'
  // Could not be determined — and this is a real, common answer, not a
  // failure. iOS can only probe the ~50 schemes declared in Info.plist, so
  // for everything else its silence proves nothing. The UI must not read
  // 'unknown' as 'not_installed': an app the host lacks is a harmless no-op
  // for them and still blocks correctly for members who have it.
  | 'unknown';

export interface BlockableApp {
  // The package name — the cross-device identity, and the only field that
  // is ever sent anywhere.
  readonly id: string;
  readonly name: string;
  // Null only for a real installed app whose ApplicationInfo.category is
  // CATEGORY_UNDEFINED (Android's category field is inconsistently
  // populated, ARCHITECTURE.md §4). Catalog entries always have one.
  readonly category: BlockedCategory | null;
  readonly installed: InstalledState;
}

export interface BlockableAppSource {
  listApps(): Promise<readonly BlockableApp[]>;
}

// iOS offers no enumeration, but it does answer one narrow question per
// app. Each scheme must be declared in Info.plist's
// LSApplicationQueriesSchemes, and Apple caps that at 50 — twenty
// questions, not a directory listing.
//
// A rejected probe resolves to 'unknown', never to 'not_installed': the
// most likely cause is a scheme missing from Info.plist, which says nothing
// about whether the app is there. Guessing 'not_installed' would hide the
// entry from a host who has it.
const probeInstalled = async (app: CatalogApp): Promise<InstalledState> => {
  if (app.iosScheme === undefined) {
    return 'unknown';
  }
  try {
    return (await Linking.canOpenURL(`${app.iosScheme}://`)) ? 'installed' : 'not_installed';
  } catch {
    return 'unknown';
  }
};

const visibleCatalog = (): readonly CatalogApp[] => APP_CATALOG.filter((app) => !isSafetyDenied(app.id));

export const catalogAppSource: BlockableAppSource = {
  async listApps(): Promise<readonly BlockableApp[]> {
    const catalog = visibleCatalog();

    // Android deliberately does NOT probe. canOpenURL means something
    // different there — it consults the manifest's intent-query allowlist,
    // not "is this app present" — so probing would produce confidently
    // wrong answers rather than no answer. 'unknown' is the truthful one
    // until InstalledAppsModule lands.
    if (Platform.OS !== 'ios') {
      return catalog.map((app) => ({
        id: app.id,
        name: app.name,
        category: app.category,
        installed: 'unknown' as const,
      }));
    }

    const states = await Promise.all(catalog.map(probeInstalled));
    return catalog.map((app, index) => ({
      id: app.id,
      name: app.name,
      category: app.category,
      installed: states[index] ?? 'unknown',
    }));
  },
};

// The one the picker imports. Android will resolve to the installed-apps
// source once task 4 lands; today both platforms read the catalog, which is
// also the permanent shape if the Play declaration is refused.
export const blockableAppSource: BlockableAppSource = catalogAppSource;
