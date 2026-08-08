const mockCanOpenURL = jest.fn();
const mockGetInstalledPackages = jest.fn();

import { Linking, NativeModules, Platform } from 'react-native';

import { APP_CATALOG, IOS_APPLICATION_QUERIES_SCHEMES } from '../config/app-catalog';
import { SAFETY_DENYLIST } from '../config/blocklist-safety';
import { blockableAppSource } from './blockable-app-source';

// The source the Create Session app picker reads through (plan §7).
//
// **The point of this file is parity.** Both platforms offer the same fixed
// catalog and each answers the same narrow per-app question — "do you have
// this one?" — through its own sanctioned mechanism. Android used to
// enumerate the whole device via QUERY_ALL_PACKAGES, which made the two a
// materially different product and carried a Play declaration that could be
// refused; that is gone (owner decision 2026-08-08).
//
// Both mechanisms are mocked here. Whether a declared iOS scheme actually
// resolves, and whether the Android <queries> block really sees a package,
// are device-only (docs/MANUAL_QA.md).

const NATIVE_MODULE_STUB = {
  getInstalledPackages: (ids: readonly string[]) => mockGetInstalledPackages(ids),
  getIcons: async () => ({}),
};

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

beforeEach(() => {
  mockCanOpenURL.mockReset().mockResolvedValue(false);
  mockGetInstalledPackages.mockReset().mockResolvedValue([]);
  (Linking as unknown as { canOpenURL: unknown }).canOpenURL = (...args: unknown[]) =>
    mockCanOpenURL(...args);
  (NativeModules as Record<string, unknown>).InstalledAppsModule = NATIVE_MODULE_STUB;
});

describe('the same catalog on both platforms', () => {
  it.each(['android', 'ios'] as const)('offers exactly the catalog on %s', async (os) => {
    setPlatform(os);

    const apps = await blockableAppSource.listApps();

    expect(apps.map((app) => app.id)).toEqual(APP_CATALOG.map((app) => app.id));
  });

  it.each(['android', 'ios'] as const)('never offers a denylisted app on %s', async (os) => {
    setPlatform(os);

    const apps = await blockableAppSource.listApps();
    const denied = apps.filter((app) => (SAFETY_DENYLIST as readonly string[]).includes(app.id));

    expect(denied).toEqual([]);
  });

  it.each(['android', 'ios'] as const)('gives every app a category on %s', async (os) => {
    setPlatform(os);

    const apps = await blockableAppSource.listApps();

    expect(apps.every((app) => app.category !== null)).toBe(true);
  });

  // The package name is the only field that ever leaves the device — it is
  // the one identifier that means the same thing on every phone.
  it.each(['android', 'ios'] as const)('carries the package name as the id on %s', async (os) => {
    setPlatform(os);

    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.name === 'Instagram')?.id).toBe('com.instagram.android');
  });
});

describe('iOS installed detection', () => {
  beforeEach(() => {
    setPlatform('ios');
  });

  it('probes each declared scheme as a bare url, once', async () => {
    await blockableAppSource.listApps();

    const probed = mockCanOpenURL.mock.calls.map(([url]) => url as string);
    expect(probed).toEqual(IOS_APPLICATION_QUERIES_SCHEMES.map((scheme) => `${scheme}://`));
  });

  it('reports an app whose scheme resolves as installed', async () => {
    mockCanOpenURL.mockImplementation(async (url: string) => url === 'instagram://');

    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('installed');
  });

  it('reports an app whose scheme does not resolve as not installed', async () => {
    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('not_installed');
  });

  // Apple caps LSApplicationQueriesSchemes at 50, so most of the catalog is
  // unprobeable by construction. Those entries are shown UNFILTERED rather
  // than hidden: blocking an app the host doesn't own is a no-op for them
  // and still blocks correctly for members who do.
  it('reports an app with no declared scheme as unknown, and still lists it', async () => {
    const apps = await blockableAppSource.listApps();
    const noScheme = APP_CATALOG.find((app) => app.iosScheme === undefined);

    expect(apps.find((app) => app.id === noScheme?.id)?.installed).toBe('unknown');
  });

  it('degrades a rejected probe to unknown rather than failing the whole picker', async () => {
    mockCanOpenURL.mockRejectedValue(new Error('scheme not declared in Info.plist'));

    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('unknown');
    expect(apps).toHaveLength(APP_CATALOG.length);
  });

  it('never asks the Android module', async () => {
    await blockableAppSource.listApps();

    expect(mockGetInstalledPackages).not.toHaveBeenCalled();
  });
});

describe('Android installed detection', () => {
  beforeEach(() => {
    setPlatform('android');
  });

  // Exactly the catalog and nothing else — the manifest's <queries> block is
  // generated from it, so anything outside is invisible to the OS anyway.
  it('asks only about the catalog packages', async () => {
    await blockableAppSource.listApps();

    expect(mockGetInstalledPackages).toHaveBeenCalledWith(APP_CATALOG.map((app) => app.id));
  });

  it('reports the packages the device has as installed', async () => {
    mockGetInstalledPackages.mockResolvedValue(['com.instagram.android']);

    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('installed');
  });

  it('reports the rest as not installed', async () => {
    mockGetInstalledPackages.mockResolvedValue(['com.instagram.android']);

    const apps = await blockableAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.whatsapp')?.installed).toBe('not_installed');
  });

  it('never probes canOpenURL, which means something else entirely on Android', async () => {
    await blockableAppSource.listApps();

    expect(mockCanOpenURL).not.toHaveBeenCalled();
  });

  // A build without the module can ask nothing, so it claims nothing. The
  // catalog is still offered in full — unfiltered is a degraded experience,
  // not a broken one.
  it('reports everything as unknown when the native module is missing', async () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    const apps = await blockableAppSource.listApps();

    expect(apps).toHaveLength(APP_CATALOG.length);
    expect(apps.every((app) => app.installed === 'unknown')).toBe(true);
  });

  // A failed query is "we learned nothing", never "you have none of these".
  // Collapsing the two would report every app as absent and hide the ones
  // the host actually has — a false claim about their own phone, and the
  // one thing this filtering must never make.
  it('reports unknown, not absent, when the query fails outright', async () => {
    mockGetInstalledPackages.mockRejectedValue(new Error('bridge failure'));

    const apps = await blockableAppSource.listApps();

    expect(apps.every((app) => app.installed === 'unknown')).toBe(true);
  });

  // ...but a genuinely empty answer IS a statement: the device was asked and
  // has none of them.
  it('reports absent when the device really answered with none', async () => {
    mockGetInstalledPackages.mockResolvedValue([]);

    const apps = await blockableAppSource.listApps();

    expect(apps.every((app) => app.installed === 'not_installed')).toBe(true);
  });
});
