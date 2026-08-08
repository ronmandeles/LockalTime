const mockGetInstalledApps = jest.fn();
const mockGetIcons = jest.fn();

import { NativeModules, Platform } from 'react-native';

const NATIVE_MODULE_STUB = {
  getInstalledApps: (...args: unknown[]) => mockGetInstalledApps(...args),
  getIcons: (...args: unknown[]) => mockGetIcons(...args),
};

import { installedApps } from './installed-apps';

// JS-side contract test over a mocked bridge — the only kind possible for
// a native module (.claude/skills/testing-standards/SKILL.md). What it
// pins is everything on THIS side of the bridge: that a malformed row is
// dropped rather than trusted, that a denylisted app can never reach the
// picker even if the OS hands it to us, and that an unavailable module is
// an empty list rather than a crash. Whether PackageManager actually
// returns Instagram is manual QA (docs/MANUAL_QA.md).

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

const row = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  packageName: 'com.instagram.android',
  label: 'Instagram',
  category: 'social',
  ...overrides,
});

beforeEach(() => {
  setPlatform('android');
  (NativeModules as Record<string, unknown>).InstalledAppsModule = NATIVE_MODULE_STUB;
  mockGetInstalledApps.mockReset();
  mockGetIcons.mockReset();
});

describe('installedApps.isAvailable', () => {
  it('is true when the native module is registered on Android', () => {
    expect(installedApps.isAvailable()).toBe(true);
  });

  it('is false when no native module is registered', () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    expect(installedApps.isAvailable()).toBe(false);
  });

  // There is no iOS counterpart and there never will be one — iOS offers no
  // app enumeration at all. The seam points iOS at the catalog instead.
  it('is false on iOS even if something is registered under the name', () => {
    setPlatform('ios');

    expect(installedApps.isAvailable()).toBe(false);
  });
});

describe('installedApps.list', () => {
  it('maps a well-formed native row', async () => {
    mockGetInstalledApps.mockResolvedValue([row()]);

    await expect(installedApps.list()).resolves.toEqual([
      { packageName: 'com.instagram.android', label: 'Instagram', category: 'social' },
    ]);
  });

  it('returns an empty list rather than throwing when no module is registered', async () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    await expect(installedApps.list()).resolves.toEqual([]);
  });

  it('returns an empty list when the native call rejects', async () => {
    mockGetInstalledApps.mockRejectedValue(new Error('QUERY_ALL_PACKAGES not granted'));

    await expect(installedApps.list()).resolves.toEqual([]);
  });

  it('returns an empty list when the bridge hands back something that is not an array', async () => {
    mockGetInstalledApps.mockResolvedValue({ nope: true });

    await expect(installedApps.list()).resolves.toEqual([]);
  });

  // Android's ApplicationInfo.category is inconsistently populated —
  // CATEGORY_UNDEFINED is common (ARCHITECTURE.md §4). Such an app is still
  // pickable by name; it just isn't covered by any category toggle.
  it('keeps an app whose category Android does not know, as null', async () => {
    mockGetInstalledApps.mockResolvedValue([row({ category: null })]);

    await expect(installedApps.list()).resolves.toEqual([
      { packageName: 'com.instagram.android', label: 'Instagram', category: null },
    ]);
  });

  it('nulls a category string that is not one of ours rather than trusting it', async () => {
    mockGetInstalledApps.mockResolvedValue([row({ category: 'photography' })]);

    await expect(installedApps.list()).resolves.toEqual([
      { packageName: 'com.instagram.android', label: 'Instagram', category: null },
    ]);
  });

  it.each<[Record<string, unknown>, string]>([
    [{ packageName: 42 }, 'a non-string package name'],
    [{ packageName: '' }, 'an empty package name'],
    [{ label: 42 }, 'a non-string label'],
  ])('drops a row with %s', async (overrides) => {
    mockGetInstalledApps.mockResolvedValue([row(overrides), row({ packageName: 'com.other.app' })]);

    const apps = await installedApps.list();

    expect(apps.map((app) => app.packageName)).toEqual(['com.other.app']);
  });

  it('falls back to the package name when the OS gives no usable label', async () => {
    mockGetInstalledApps.mockResolvedValue([row({ label: '   ' })]);

    await expect(installedApps.list()).resolves.toEqual([
      {
        packageName: 'com.instagram.android',
        label: 'com.instagram.android',
        category: 'social',
      },
    ]);
  });

  // Native filters these too (default dialer resolved via TelecomManager,
  // which is the device-accurate check a static list can't make). This is
  // the JS backstop for the ones a static list CAN name — two layers,
  // because being cut off from your own phone app is not a recoverable
  // UI bug.
  it('never returns a denylisted app, even if the OS listed it', async () => {
    mockGetInstalledApps.mockResolvedValue([
      row({ packageName: 'com.android.settings', label: 'Settings', category: null }),
      row(),
    ]);

    const apps = await installedApps.list();

    expect(apps.map((app) => app.packageName)).toEqual(['com.instagram.android']);
  });

  it('drops a duplicate package name rather than listing it twice', async () => {
    mockGetInstalledApps.mockResolvedValue([row(), row({ label: 'Instagram (clone)' })]);

    const apps = await installedApps.list();

    expect(apps).toHaveLength(1);
  });
});

describe('installedApps.getIcons', () => {
  // Reviewed and corrected in the plan (§8): an earlier draft returned
  // base64 icons inline with the list. ~200 apps x a 96px PNG is 1.5-3 MB
  // of base64 across the bridge in one synchronous payload. Icons are a
  // separate, windowed call for exactly that reason.
  it('asks native only for the window it was given', async () => {
    mockGetIcons.mockResolvedValue({});

    await installedApps.getIcons(['com.instagram.android', 'com.whatsapp']);

    expect(mockGetIcons).toHaveBeenCalledWith(['com.instagram.android', 'com.whatsapp']);
  });

  it('never crosses the bridge at all for an empty window', async () => {
    await installedApps.getIcons([]);

    expect(mockGetIcons).not.toHaveBeenCalled();
  });

  it('returns the data uris native provided', async () => {
    mockGetIcons.mockResolvedValue({ 'com.instagram.android': 'data:image/png;base64,AAAA' });

    await expect(installedApps.getIcons(['com.instagram.android'])).resolves.toEqual({
      'com.instagram.android': 'data:image/png;base64,AAAA',
    });
  });

  it('drops an entry whose value is not a string', async () => {
    mockGetIcons.mockResolvedValue({ 'com.instagram.android': 42, 'com.whatsapp': 'data:x' });

    await expect(
      installedApps.getIcons(['com.instagram.android', 'com.whatsapp']),
    ).resolves.toEqual({ 'com.whatsapp': 'data:x' });
  });

  // An icon is decoration. Losing one must never take the picker with it.
  it('resolves to an empty map when the native call rejects', async () => {
    mockGetIcons.mockRejectedValue(new Error('decode failed'));

    await expect(installedApps.getIcons(['com.instagram.android'])).resolves.toEqual({});
  });

  it('resolves to an empty map when no module is registered', async () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    await expect(installedApps.getIcons(['com.instagram.android'])).resolves.toEqual({});
  });
});
