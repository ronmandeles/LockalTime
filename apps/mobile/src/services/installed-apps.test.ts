const mockGetInstalledPackages = jest.fn();
const mockGetIcons = jest.fn();

import { NativeModules, Platform } from 'react-native';

const NATIVE_MODULE_STUB = {
  getInstalledPackages: (...args: unknown[]) => mockGetInstalledPackages(...args),
  getIcons: (...args: unknown[]) => mockGetIcons(...args),
};

import { installedApps } from './installed-apps';

// JS-side contract test over a mocked bridge — the only kind possible for a
// native module (.claude/skills/testing-standards/SKILL.md).
//
// The module answers ONE question: is this specific package installed? It
// used to enumerate the whole device; that stopped (owner decision
// 2026-08-08) when both platforms moved to the same fixed catalog, which
// also retired QUERY_ALL_PACKAGES and its Play Console declaration.
//
// Whether the manifest's <queries> block really lets the OS see a given
// package is device-only (docs/MANUAL_QA.md).

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

beforeEach(() => {
  setPlatform('android');
  (NativeModules as Record<string, unknown>).InstalledAppsModule = NATIVE_MODULE_STUB;
  mockGetInstalledPackages.mockReset().mockResolvedValue([]);
  mockGetIcons.mockReset().mockResolvedValue({});
});

describe('installedApps.isAvailable', () => {
  it('is true when the native module is registered on Android', () => {
    expect(installedApps.isAvailable()).toBe(true);
  });

  it('is false when no native module is registered', () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    expect(installedApps.isAvailable()).toBe(false);
  });

  // There is no iOS counterpart and there never will be one — iOS answers
  // the same question through canOpenURL instead.
  it('is false on iOS even if something is registered under the name', () => {
    setPlatform('ios');

    expect(installedApps.isAvailable()).toBe(false);
  });
});

describe('installedApps.getInstalledPackages', () => {
  it('asks native for exactly the packages it was given', async () => {
    await installedApps.getInstalledPackages(['com.instagram.android', 'com.whatsapp']);

    expect(mockGetInstalledPackages).toHaveBeenCalledWith([
      'com.instagram.android',
      'com.whatsapp',
    ]);
  });

  it('returns the installed subset as a set', async () => {
    mockGetInstalledPackages.mockResolvedValue(['com.instagram.android']);

    const installed = await installedApps.getInstalledPackages([
      'com.instagram.android',
      'com.whatsapp',
    ]);

    expect(installed).toEqual(new Set(['com.instagram.android']));
  });

  it('never crosses the bridge at all for an empty question', async () => {
    await expect(installedApps.getInstalledPackages([])).resolves.toEqual(new Set());
    expect(mockGetInstalledPackages).not.toHaveBeenCalled();
  });

  // The distinction between these two is the whole reason this returns a
  // nullable set. An empty set is a real answer about the device; null is
  // "we could not ask". Collapsing them would report every app as absent on
  // any failure, hiding apps the host actually has.
  it('returns an empty set when the device genuinely has none of them', async () => {
    mockGetInstalledPackages.mockResolvedValue([]);

    await expect(installedApps.getInstalledPackages(['com.instagram.android'])).resolves.toEqual(
      new Set(),
    );
  });

  it('returns null when no module is registered', async () => {
    delete (NativeModules as Record<string, unknown>).InstalledAppsModule;

    await expect(installedApps.getInstalledPackages(['com.instagram.android'])).resolves.toBeNull();
  });

  it('returns null when the native call rejects', async () => {
    mockGetInstalledPackages.mockRejectedValue(new Error('bridge failure'));

    await expect(installedApps.getInstalledPackages(['com.instagram.android'])).resolves.toBeNull();
  });

  it('returns null when the bridge hands back something that is not an array', async () => {
    mockGetInstalledPackages.mockResolvedValue({ nope: true });

    await expect(installedApps.getInstalledPackages(['com.instagram.android'])).resolves.toBeNull();
  });

  it('drops non-string entries rather than trusting the bridge payload', async () => {
    mockGetInstalledPackages.mockResolvedValue(['com.instagram.android', 42, null, '']);

    await expect(installedApps.getInstalledPackages(['com.instagram.android'])).resolves.toEqual(
      new Set(['com.instagram.android']),
    );
  });
});

describe('installedApps.getIcons', () => {
  // Reviewed and corrected in the plan (§8): an earlier draft returned
  // base64 icons inline with the app list. ~200 apps x a 96px PNG is 1.5-3
  // MB of base64 across the bridge in one payload. Still windowed even
  // though the catalog is bounded — the cost is per-icon decode, not length.
  it('asks native only for the window it was given', async () => {
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

    await expect(installedApps.getIcons(['com.instagram.android', 'com.whatsapp'])).resolves.toEqual(
      { 'com.whatsapp': 'data:x' },
    );
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
