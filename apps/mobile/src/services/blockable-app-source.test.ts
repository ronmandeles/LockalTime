const mockCanOpenURL = jest.fn();

import { Linking, Platform } from 'react-native';

import { APP_CATALOG, IOS_APPLICATION_QUERIES_SCHEMES } from '../config/app-catalog';
import { SAFETY_DENYLIST } from '../config/blocklist-safety';
import { blockableAppSource, catalogAppSource } from './blockable-app-source';

// The seam the Create Session app picker reads through (plan §7). Its whole
// job is that both platforms are one component:
//
//   * iOS has no app enumeration at all, but canOpenURL answers one narrow
//     question per app — so the catalog gets filtered down to roughly what
//     the host really has, and the picker reads as "your apps" rather than
//     "popular apps".
//   * Android will point at InstalledAppsModule (task 4) for the real list.
//     Until then — and permanently, if Google refuses QUERY_ALL_PACKAGES —
//     it reads the same catalog iOS does, with no UI change either way.
//
// Linking.canOpenURL is mocked here; whether each declared scheme actually
// resolves on a real iPhone is manual QA (docs/MANUAL_QA.md).

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

beforeEach(() => {
  mockCanOpenURL.mockReset();
  (Linking as unknown as { canOpenURL: unknown }).canOpenURL = (...args: unknown[]) =>
    mockCanOpenURL(...args);
});

describe('catalogAppSource on iOS', () => {
  beforeEach(() => {
    setPlatform('ios');
  });

  it('probes each declared scheme as a bare url, once', async () => {
    mockCanOpenURL.mockResolvedValue(false);

    await catalogAppSource.listApps();

    const probed = mockCanOpenURL.mock.calls.map(([url]) => url as string);
    expect(probed).toEqual(IOS_APPLICATION_QUERIES_SCHEMES.map((scheme) => `${scheme}://`));
  });

  it('reports an app whose scheme resolves as installed', async () => {
    mockCanOpenURL.mockImplementation(async (url: string) => url === 'instagram://');

    const apps = await catalogAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('installed');
  });

  it('reports an app whose scheme does not resolve as not installed', async () => {
    mockCanOpenURL.mockResolvedValue(false);

    const apps = await catalogAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('not_installed');
  });

  // Apple caps LSApplicationQueriesSchemes at 50, so most of the catalog is
  // unprobeable by construction. Those entries are shown UNFILTERED rather
  // than hidden: blocking an app the host doesn't own is a no-op for them
  // and still blocks correctly for members who do.
  it('reports an app with no declared scheme as unknown, and still lists it', async () => {
    mockCanOpenURL.mockResolvedValue(false);

    const apps = await catalogAppSource.listApps();
    const noScheme = APP_CATALOG.find((app) => app.iosScheme === undefined);
    const listed = apps.find((app) => app.id === noScheme?.id);

    expect(listed).toBeDefined();
    expect(listed?.installed).toBe('unknown');
  });

  it('degrades a rejected probe to unknown rather than failing the whole picker', async () => {
    mockCanOpenURL.mockRejectedValue(new Error('scheme not declared in Info.plist'));

    const apps = await catalogAppSource.listApps();

    expect(apps.find((app) => app.id === 'com.instagram.android')?.installed).toBe('unknown');
    expect(apps.length).toBe(APP_CATALOG.length);
  });

  it('carries the package name as the id, since that is the only thing that travels between phones', async () => {
    mockCanOpenURL.mockResolvedValue(true);

    const apps = await catalogAppSource.listApps();

    expect(apps.find((app) => app.name === 'Instagram')?.id).toBe('com.instagram.android');
  });
});

describe('catalogAppSource on Android', () => {
  beforeEach(() => {
    setPlatform('android');
  });

  // canOpenURL means something different on Android (it consults the
  // intent-query allowlist, not "is this app present"), so probing it here
  // would produce confidently wrong answers rather than no answer.
  it('never probes canOpenURL', async () => {
    await catalogAppSource.listApps();

    expect(mockCanOpenURL).not.toHaveBeenCalled();
  });

  it('reports every entry as unknown rather than guessing', async () => {
    const apps = await catalogAppSource.listApps();

    expect(apps.every((app) => app.installed === 'unknown')).toBe(true);
  });
});

describe('the seam, on both platforms', () => {
  it.each(['android', 'ios'] as const)('never offers a denylisted app on %s', async (os) => {
    setPlatform(os);
    mockCanOpenURL.mockResolvedValue(true);

    const apps = await blockableAppSource.listApps();
    const denied = apps.filter((app) => (SAFETY_DENYLIST as readonly string[]).includes(app.id));

    expect(denied).toEqual([]);
  });

  it.each(['android', 'ios'] as const)('gives every app a category on %s', async (os) => {
    setPlatform(os);
    mockCanOpenURL.mockResolvedValue(true);

    const apps = await blockableAppSource.listApps();

    expect(apps.every((app) => app.category !== null)).toBe(true);
  });

  // Task 4 will point Android at InstalledAppsModule. Until it does — and
  // permanently if the Play declaration is refused — both platforms resolve
  // to the same catalog source, which is exactly the mitigation the seam
  // exists to make cheap (plan §10).
  it.each(['android', 'ios'] as const)('resolves to the catalog source today on %s', (os) => {
    setPlatform(os);

    expect(blockableAppSource).toBe(catalogAppSource);
  });
});
