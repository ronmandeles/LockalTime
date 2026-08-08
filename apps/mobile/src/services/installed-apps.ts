import { NativeModules, Platform } from 'react-native';

import { isBlockedCategory, type BlockedCategory } from '../config/blocked-categories';
import { isSafetyDenied } from '../config/blocklist-safety';

// Android's real installed-app list, for the Create Session picker
// (docs/BLOCKLIST_SELECTION_PLAN.md §8). Android-only by nature, not by
// omission: iOS offers no app enumeration at all, which is why the picker
// reads through blockable-app-source.ts rather than calling this directly.
//
// Needs QUERY_ALL_PACKAGES, a restricted permission requiring a Play
// Console declaration that can take weeks and can be refused (§10). Every
// path here degrades to an empty list rather than an error, so a refusal —
// or simply an older build without the module — lands the picker on the
// bundled catalog instead of breaking it.
//
// Read fresh on every call, never cached at module load: caching a
// reference in a top-level const makes the seam unmockable in Jest, since
// imports execute before any later test mutation of NativeModules (the
// same lesson as blocking-permissions.ts and app-blocker.ts).

export interface InstalledApp {
  readonly packageName: string;
  readonly label: string;
  // Null where Android reports CATEGORY_UNDEFINED, which is common — the
  // field is developer-declared and inconsistently populated
  // (ARCHITECTURE.md §4). Such an app is still pickable by name; it simply
  // isn't covered by any category toggle.
  readonly category: BlockedCategory | null;
}

interface NativeInstalledAppsModule {
  getInstalledApps(): Promise<unknown>;
  getIcons(packageNames: readonly string[]): Promise<unknown>;
}

const getNativeModule = (): NativeInstalledAppsModule | undefined => {
  if (Platform.OS !== 'android') {
    return undefined;
  }
  return (NativeModules as Record<string, unknown>).InstalledAppsModule as
    | NativeInstalledAppsModule
    | undefined;
};

// Boundary validation on native-bridge data (typescript-strictness skill):
// nothing crossing the bridge is trusted as already-typed. A malformed row
// is dropped rather than repaired, except for the label — an app with no
// usable label is still a real app the host may want to block, so it falls
// back to its package name rather than disappearing.
const toInstalledApp = (raw: unknown): InstalledApp | null => {
  if (typeof raw !== 'object' || raw === null) {
    return null;
  }
  const value = raw as Record<string, unknown>;
  if (typeof value.packageName !== 'string' || value.packageName.length === 0) {
    return null;
  }
  if (value.label !== undefined && typeof value.label !== 'string') {
    return null;
  }
  const label = typeof value.label === 'string' ? value.label.trim() : '';

  return {
    packageName: value.packageName,
    label: label.length > 0 ? label : value.packageName,
    category: isBlockedCategory(value.category) ? value.category : null,
  };
};

export interface InstalledAppsService {
  // Whether a real enumeration is possible here at all. The picker uses
  // this to decide whether to read the device or the bundled catalog.
  isAvailable(): boolean;
  list(): Promise<readonly InstalledApp[]>;
  // Icons for the visible window only, never the whole list. ~200 apps x a
  // 96px PNG is 1.5-3 MB of base64 in one synchronous bridge payload, which
  // will jank (plan §8, corrected from an earlier draft that returned icons
  // inline). Returns package name -> data URI; a missing entry just means
  // no icon, never an error.
  getIcons(packageNames: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

export const installedApps: InstalledAppsService = {
  isAvailable: (): boolean => getNativeModule() !== undefined,

  list: async (): Promise<readonly InstalledApp[]> => {
    const native = getNativeModule();
    if (native === undefined) {
      return [];
    }

    let raw: unknown;
    try {
      raw = await native.getInstalledApps();
    } catch {
      // Most likely QUERY_ALL_PACKAGES was never granted. An empty list is
      // the honest answer and the seam's fallback trigger — never an error
      // the picker has to render.
      return [];
    }
    if (!Array.isArray(raw)) {
      return [];
    }

    const seen = new Set<string>();
    return raw.flatMap((entry) => {
      const app = toInstalledApp(entry);
      if (app === null || seen.has(app.packageName) || isSafetyDenied(app.packageName)) {
        return [];
      }
      seen.add(app.packageName);
      return [app];
    });
  },

  getIcons: async (packageNames): Promise<Readonly<Record<string, string>>> => {
    if (packageNames.length === 0) {
      return {};
    }
    const native = getNativeModule();
    if (native === undefined) {
      return {};
    }

    let raw: unknown;
    try {
      raw = await native.getIcons([...packageNames]);
    } catch {
      // An icon is decoration; losing one must never take the picker with
      // it.
      return {};
    }
    if (typeof raw !== 'object' || raw === null) {
      return {};
    }

    const icons: Record<string, string> = {};
    Object.entries(raw as Record<string, unknown>).forEach(([packageName, uri]) => {
      if (typeof uri === 'string') {
        icons[packageName] = uri;
      }
    });
    return icons;
  },
};
