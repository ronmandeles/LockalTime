const mockStart = jest.fn();
const mockStop = jest.fn();
const mockGetStatus = jest.fn();

import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

// NativeModules/DeviceEventEmitter come from the RN jest preset's own mock —
// mutated in place rather than replaced via jest.mock('react-native', ...),
// which would eagerly re-evaluate the whole real module (same reasoning as
// blocking-permissions.test.ts).
(NativeModules as Record<string, unknown>).AppBlockerModule = {
  start: (...args: unknown[]) => mockStart(...args),
  stop: (...args: unknown[]) => mockStop(...args),
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  addListener: () => {},
  removeListeners: () => {},
};

import { appBlocker } from './app-blocker';

// Phase 3 tasks 3.0/3.3 (backlog.md): the AppBlockerModule contract, and its
// real Android implementation. Android emits events via the Kotlin module's
// AppBlockerModule.emitEvent -> RCTDeviceEventEmitter (BlockerForegroundService.kt),
// so the JS side listens on the shared DeviceEventEmitter directly rather
// than wrapping a NativeEventEmitter around the native module — the
// Kotlin module's addListener/removeListeners are no-op bookkeeping methods
// only (required by the bridge, not by this delivery path). iOS keeps the
// Phase 3.0 placeholder until task 3.6 wires FamilyControls; this suite
// pins both branches. NativeModules is mocked (no real bridge in Jest); the
// real OS/native behavior is manual QA (docs/MANUAL_QA.md), but the Kotlin
// module itself is Gradle-build-verified.

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

const CONFIG = { sessionId: 'session-1', endsAt: null, blockedCategories: ['social'] as const };

describe('appBlocker on Android', () => {
  beforeEach(() => {
    setPlatform('android');
    mockStart.mockReset().mockResolvedValue(undefined);
    mockStop.mockReset().mockResolvedValue(undefined);
    mockGetStatus.mockReset();
  });

  it('start forwards the session config to the native module', async () => {
    await appBlocker.start(CONFIG);

    expect(mockStart).toHaveBeenCalledWith({
      sessionId: 'session-1',
      endsAt: null,
      blockedCategories: ['social'],
    });
  });

  it('stop calls the native module', async () => {
    await appBlocker.stop();

    expect(mockStop).toHaveBeenCalledTimes(1);
  });

  it('getStatus forwards a real active status', async () => {
    mockGetStatus.mockResolvedValue({ state: 'active', sessionId: 'session-1' });

    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'active', sessionId: 'session-1' });
  });

  it('getStatus forwards a real violation status', async () => {
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
    mockGetStatus.mockResolvedValue({ state: 'not-a-real-state' });

    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  it('getStatus falls back to inactive for a violation payload with an unrecognized reason', async () => {
    mockGetStatus.mockResolvedValue({ state: 'violation', sessionId: 'session-1', reason: 'made-up' });

    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  describe('addEventListener', () => {
    it('forwards a valid shield_triggered event', () => {
      const listener = jest.fn();
      appBlocker.addEventListener(listener);

      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });

      expect(listener).toHaveBeenCalledWith({
        type: 'shield_triggered',
        sessionId: 'session-1',
        category: 'social',
        at: '2026-07-27T00:00:00.000Z',
      });
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

      DeviceEventEmitter.emit('permission_revoked', { sessionId: 'session-1', permission: 'overlay' });

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

      expect(listener).toHaveBeenCalledWith({ type: 'battery_critical', sessionId: 'session-1', level: 4 });
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
      DeviceEventEmitter.emit('battery_critical', { sessionId: 'session-1', level: 'not-a-number' });

      expect(listener).not.toHaveBeenCalled();
    });

    it('unsubscribe stops delivering events', () => {
      const listener = jest.fn();
      const unsubscribe = appBlocker.addEventListener(listener);

      unsubscribe();
      DeviceEventEmitter.emit('shield_triggered', {
        sessionId: 'session-1',
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
});

describe('appBlocker on iOS (Phase 3.0 placeholder, until task 3.6)', () => {
  beforeEach(() => {
    setPlatform('ios');
  });

  it('start resolves without calling any native module', async () => {
    await expect(appBlocker.start(CONFIG)).resolves.toBeUndefined();
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('stop resolves without calling any native module', async () => {
    await expect(appBlocker.stop()).resolves.toBeUndefined();
    expect(mockStop).not.toHaveBeenCalled();
  });

  it("getStatus resolves { state: 'inactive' }", async () => {
    await expect(appBlocker.getStatus()).resolves.toEqual({ state: 'inactive' });
  });

  it('addEventListener never invokes the listener', () => {
    const listener = jest.fn();
    appBlocker.addEventListener(listener);

    DeviceEventEmitter.emit('shield_triggered', {
      sessionId: 'session-1',
      category: 'social',
      at: '2026-07-27T00:00:00.000Z',
    });

    expect(listener).not.toHaveBeenCalled();
  });

  it('addEventListener returns a safe-to-call unsubscribe', () => {
    const unsubscribe = appBlocker.addEventListener(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
