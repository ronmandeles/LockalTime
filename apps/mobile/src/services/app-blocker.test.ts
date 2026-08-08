const mockStart = jest.fn();
const mockStop = jest.fn();
const mockGetStatus = jest.fn();

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

// NativeModules/DeviceEventEmitter come from the RN jest preset's own mock —
// mutated in place rather than replaced via jest.mock('react-native', ...),
// which would eagerly re-evaluate the whole real module (same reasoning as
// blocking-permissions.test.ts).
const NATIVE_MODULE_STUB = {
  start: (...args: unknown[]) => mockStart(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  addListener: () => {},
  removeListeners: () => {},
};

import { appBlocker } from './app-blocker';

// Phase 3 tasks 3.0/3.3 (Android)/3.6 (iOS): both platforms register a real
// native module under the same name, AppBlockerModule, with the same
// start/stop/getStatus shape — start/stop/getStatus need no Platform.OS
// branching, just "is a module registered." Event *delivery* genuinely
// differs though: Android's Kotlin module emits via the shared
// RCTDeviceEventEmitter (BlockerForegroundService.kt calling
// AppBlockerModule.emitEvent), so JS listens on the shared DeviceEventEmitter
// directly; iOS's Swift module is an RCTEventEmitter subclass, so JS must
// wrap it in its own NativeEventEmitter — see app-blocker.ts's header.
// NativeModules is mocked (no real bridge in Jest); the real OS/native
// behavior is manual QA (docs/MANUAL_QA.md). Android's Kotlin module is
// Gradle-build-verified; iOS's Swift module is written but not yet linked
// into the Xcode project (no Mac).

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

const CONFIG = {
  sessionId: 'session-1',
  endsAt: null,
  blockedCategories: ['social'] as const,
  blockedPackages: ['com.instagram.android'],
  overlayCopy: { blockedApp: '%s is blocked.', blockedGeneric: 'This app is blocked.' },
};

describe('appBlocker with a native module registered', () => {
  beforeEach(() => {
    (NativeModules as Record<string, unknown>).AppBlockerModule = NATIVE_MODULE_STUB;
    mockStart.mockReset().mockResolvedValue(undefined);
    mockStop.mockReset().mockResolvedValue(undefined);
    mockGetStatus.mockReset();
  });

  it.each(['android', 'ios'] as const)(
    'start forwards the session config to the native module on %s',
    async (os) => {
      setPlatform(os);
      await appBlocker.start(CONFIG);

      // The overlay copy crosses as two flat strings rather than a nested
      // map — the bridge sees a plain object either way, and flattening
      // keeps the native read (AppBlockerModule.kt) a straight getString.
      expect(mockStart).toHaveBeenCalledWith({
        sessionId: 'session-1',
        endsAt: null,
        blockedCategories: ['social'],
        blockedPackages: ['com.instagram.android'],
        overlayBlockedApp: '%s is blocked.',
        overlayBlockedGeneric: 'This app is blocked.',
      });
    },
  );

  it.each(['android', 'ios'] as const)('stop calls the native module on %s', async (os) => {
    setPlatform(os);
    await appBlocker.stop();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('getStatus forwards a real active status', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({ state: 'active', sessionId: 'session-1' });

    await expect(appBlocker.getStatus()).resolves.toEqual({
      state: 'active',
      sessionId: 'session-1',
    });
  });

  it('getStatus forwards a real violation status', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({
      state: 'violation',
      sessionId: 'session-1',
      reason: 'permission_revoked',
    });

    await expect(appBlocker.getStatus()).resolves.toEqual({
      state: 'violation',
      sessionId: 'session-1',
      reason: 'permission_revoked',
    });
  });

  it('getStatus falls back to inactive for a garbage native payload — boundary validation', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({ state: 'not-a-real-state' });

    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  it('getStatus falls back to inactive for a violation payload with an unrecognized reason', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({
      state: 'violation',
      sessionId: 'session-1',
      reason: 'made-up',
    });

    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  describe('addEventListener on Android (shared DeviceEventEmitter)', () => {
    beforeEach(() => {
      setPlatform('android');
    });

    it('forwards a category-triggered shield event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'shield_triggered',
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });
    });

    // Phase 9: a block triggered by a specific PACKAGE has no valid value
    // for the old `category` field. Before the shape was widened, this
    // payload was dropped outright by the boundary validation — silently,
    // since a dropped event looks exactly like no event at all.
    it('forwards a package-triggered shield event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'package',
        packageName: 'com.instagram.android',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'shield_triggered',
        sessionId: 'session-1',
        reason: 'package',
        packageName: 'com.instagram.android',
        at: '2026-07-27T00:00:00.000Z',
      });
    });

    // The exact regression the plan warned about: three categories became
    // six, and the second private copy of the list that used to live in
    // app-blocker.ts would have dropped every event for the new three.
    it.each(['news', 'maps', 'productivity'] as const)(
      'forwards a shield event for the %s category added in Phase 9',
      (category) => {
        const listener = jest.fn();
        appBlocker.addEventListener(listener);

        DeviceEventEmitter.emit('shield_triggered', {
          sessionId: 'session-1',
          reason: 'category',
          category,
          at: '2026-07-27T00:00:00.000Z',
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'category', category }),
        );
      },
    );

    it.each<[Record<string, unknown>, string]>([
      [{ reason: 'category', category: 'photography' }, 'a category outside the six'],
      [{ reason: 'package' }, 'a package trigger with no package name'],
      [{ reason: 'package', packageName: '' }, 'an empty package name'],
      [{ category: 'social' }, 'no reason at all'],
      [{ reason: 'telepathy', category: 'social' }, 'an unrecognized reason'],
    ])('drops a shield payload with %s', (payload) => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        at: '2026-07-27T00:00:00.000Z',
        ...payload,
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('forwards a valid service_killed event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('service_killed', {
        sessionId: 'session-1',
        lastSeenAt: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'service_killed',
        sessionId: 'session-1',
        lastSeenAt: '2026-07-27T00:00:00.000Z',
      });
    });

    it('forwards a valid permission_revoked event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('permission_revoked', {
        sessionId: 'session-1',
        permission: 'overlay',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'permission_revoked',
        sessionId: 'session-1',
        permission: 'overlay',
      });
    });

    it('forwards a valid battery_critical event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('battery_critical', { sessionId: 'session-1', level: 4 });

      expect(listener).toHaveBeenCalledWith({
        type: 'battery_critical',
        sessionId: 'session-1',
        level: 4,
      });
    });

    it('forwards a valid offline_cutoff_reached event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('offline_cutoff_reached', {
        sessionId: 'session-1',
        lastConnectedAt: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'offline_cutoff_reached',
        sessionId: 'session-1',
        lastConnectedAt: '2026-07-27T00:00:00.000Z',
      });
    });

    it('drops a malformed payload instead of forwarding garbage — boundary validation', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', { sessionId: 'session-1' });
      DeviceEventEmitter.emit('battery_critical', {
        sessionId: 'session-1',
        level: 'not-a-number',
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe stops delivering events', () => {
      const listener = jest.fn();
      const unsubscribe = appBlocker.addEventListener(listener);

      unsubscribe();
      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribing is safe to call more than once', () => {
      const unsubscribe = appBlocker.addEventListener(() => {});

      expect(() => {
        unsubscribe();
        unsubscribe();
      }).not.toThrow();
    });
  });

  describe('addEventListener on iOS (NativeEventEmitter wrapping the module)', () => {
    beforeEach(() => {
      setPlatform('ios');
    });

    it('forwards a category-triggered shield event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'shield_triggered',
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });
    });

    // Phase 9: a block triggered by a specific PACKAGE has no valid value
    // for the old `category` field. Before the shape was widened, this
    // payload was dropped outright by the boundary validation — silently,
    // since a dropped event looks exactly like no event at all.
    it('forwards a package-triggered shield event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'package',
        packageName: 'com.instagram.android',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'shield_triggered',
        sessionId: 'session-1',
        reason: 'package',
        packageName: 'com.instagram.android',
        at: '2026-07-27T00:00:00.000Z',
      });
    });

    // The exact regression the plan warned about: three categories became
    // six, and the second private copy of the list that used to live in
    // app-blocker.ts would have dropped every event for the new three.
    it.each(['news', 'maps', 'productivity'] as const)(
      'forwards a shield event for the %s category added in Phase 9',
      (category) => {
        const listener = jest.fn();
        appBlocker.addEventListener(listener);

        DeviceEventEmitter.emit('shield_triggered', {
          sessionId: 'session-1',
          reason: 'category',
          category,
          at: '2026-07-27T00:00:00.000Z',
        });

        expect(listener).toHaveBeenCalledWith(
          expect.objectContaining({ reason: 'category', category }),
        );
      },
    );

    it.each<[Record<string, unknown>, string]>([
      [{ reason: 'category', category: 'photography' }, 'a category outside the six'],
      [{ reason: 'package' }, 'a package trigger with no package name'],
      [{ reason: 'package', packageName: '' }, 'an empty package name'],
      [{ category: 'social' }, 'no reason at all'],
      [{ reason: 'telepathy', category: 'social' }, 'an unrecognized reason'],
    ])('drops a shield payload with %s', (payload) => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        at: '2026-07-27T00:00:00.000Z',
        ...payload,
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('drops a malformed payload instead of forwarding garbage — boundary validation', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('battery_critical', {
        sessionId: 'session-1',
        level: 'not-a-number',
      });

      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe stops delivering events', () => {
      const listener = jest.fn();
      const unsubscribe = appBlocker.addEventListener(listener);

      unsubscribe();
      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).not.toHaveBeenCalled();
    });
  });
});

describe("appBlocker with no native module registered (today's real state on iOS until a build links one)", () => {
  beforeEach(() => {
    delete (NativeModules as Record<string, unknown>).AppBlockerModule;
  });

  it.each(['android', 'ios'] as const)('start resolves without throwing on %s', async (os) => {
    setPlatform(os);
    await expect(appBlocker.start(CONFIG)).resolves.toBeUndefined();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it.each(['android', 'ios'] as const)('stop resolves without throwing on %s', async (os) => {
    setPlatform(os);
    await expect(appBlocker.stop()).resolves.toBeUndefined();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it.each(['android', 'ios'] as const)(
    "getStatus resolves { state: 'inactive' } on %s",
    async (os) => {
      setPlatform(os);
      await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
    },
  );

  it.each(['android', 'ios'] as const)(
    'addEventListener never invokes the listener on %s',
    (os) => {
      setPlatform(os);
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        reason: 'category',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('addEventListener returns a safe-to-call unsubscribe', () => {
    setPlatform('android');
    const unsubscribe = appBlocker.addEventListener(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
