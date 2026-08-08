import { NativeModules, Platform } from 'react-native';

// Android's answer to "is this specific app installed?"
// (docs/BLOCKLIST_SELECTION_PLAN.md §8.)
//
// **This used to enumerate the whole device.** It stopped (owner decision
// 2026-08-08): both platforms now offer the same fixed, bundled catalog and
// filter it to what the host actually has, so this is the exact counterpart
// of iOS's canOpenURL probing — one narrow question per app, nothing more.
// Losing full enumeration also lost QUERY_ALL_PACKAGES, a restricted
// permission needing a Play Console declaration that can be refused.
//
// Only packages named in the manifest's <queries> block are visible, and
// that block is generated from the catalog. Anything else reports "not
// installed" whether it is there or not — which is the privacy property the
// block exists to provide, and the reason the seam treats a *missing* answer
// as unknown rather than as absence.
//
// Read fresh on every call, never cached at module load — same lesson as
// app-blocker.ts and blocking-permissions.ts.

interface NativeInstalledAppsModule {
  getInstalledPackages(packageNames: readonly string[]): Promise<unknown>;
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

export interface InstalledAppsService {
  // Whether this device can answer the installed question at all. False on
  // iOS (which uses canOpenURL instead) and on an Android build without the
  // module — in both cases the picker shows the catalog unfiltered, which is
  // harmless: an app the host lacks is a no-op for them and still blocks
  // correctly for members who have it.
  isAvailable(): boolean;
  // The installed subset of the packages asked about, or **null when the
  // question could not be asked at all**.
  //
  // That distinction is load-bearing, not defensive typing. An empty set
  // means "the device has none of these"; null means "we learned nothing".
  // Collapsing the two would report every app as absent on any bridge
  // failure — hiding apps the host actually has, and telling them something
  // false about their own phone. Never throws.
  getInstalledPackages(packageNames: readonly string[]): Promise<ReadonlySet<string> | null>;
  // Icons for the visible window only, never the whole list (plan §8,
  // corrected from an earlier design that returned them inline). Returns
  // package name -> data URI; a missing entry just means no icon.
  getIcons(packageNames: readonly string[]): Promise<Readonly<Record<string, string>>>;
}

export const installedApps: InstalledAppsService = {
  isAvailable: (): boolean => getNativeModule() !== undefined,

  getInstalledPackages: async (packageNames): Promise<ReadonlySet<string> | null> => {
    if (packageNames.length === 0) {
      return new Set();
    }
    const native = getNativeModule();
    if (native === undefined) {
      return null;
    }

    let raw: unknown;
    try {
      raw = await native.getInstalledPackages([...packageNames]);
    } catch {
      // null, not an empty set: we learned nothing. An empty set would mean
      // "you have none of these", which is a claim about the host's phone
      // that a bridge failure does not license.
      return null;
    }
    if (!Array.isArray(raw)) {
      return null;
    }
    // Boundary validation on native-bridge data (typescript-strictness):
    // nothing crossing the bridge is trusted as already-typed.
    return new Set(raw.filter((id): id is string => typeof id === 'string' && id.length > 0));
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
