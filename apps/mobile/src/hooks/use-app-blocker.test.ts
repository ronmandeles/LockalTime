import { act, renderHook } from '@testing-library/react-native';

import type { AppBlockerModule, BlockerEvent } from '../services/app-blocker';
import { useAppBlocker } from './use-app-blocker';
import type { UseAppBlockerParams } from './use-app-blocker';

// Phase 3 task 3.1 (backlog.md): useAppBlocker starts/stops the blocker off
// session state, forwards offline_cutoff_reached into the session lifecycle
// machine's OFFLINE_TIMEOUT event (owned by the native layer per
// ARCHITECTURE.md §4 — this hook only surfaces the result, never re-derives
// the cutoff), and tracks a local violation state for permission_revoked /
// service_killed / battery_critical (ARCHITECTURE.md §8 items 1-2). A fake
// AppBlockerModule is injected via the `module` param (same
// dependency-injection seam as SessionsStore) so this suite pins the hook's
// own wiring, not app-blocker.ts's real behavior.

const SESSION_ID = 'session-1';

const buildFakeModule = (): AppBlockerModule & { emit: (event: BlockerEvent) => void } => {
  const listeners: Array<(event: BlockerEvent) => void> = [];
  return {
    start: jest.fn(async () => undefined),
    stop: jest.fn(async () => undefined),
    getStatus: jest.fn(async () => ({ state: 'inactive' }) as const),
    addEventListener: (listener) => {
      listeners.push(listener);
      return () => {
        const index = listeners.indexOf(listener);
        if (index !== -1) {
          listeners.splice(index, 1);
        }
      };
    },
    emit: (event) => {
      listeners.forEach((listener) => listener(event));
    },
  };
};

const baseParams = (module: AppBlockerModule, onOfflineTimeout = jest.fn()) => ({
  sessionId: SESSION_ID,
  isSessionActive: true,
  endsAt: null,
  blockedCategories: ['social'] as const,
  onOfflineTimeout,
  module,
});

describe('useAppBlocker starting/stopping', () => {
  it('starts the module with the session config when the session is active', async () => {
    const module = buildFakeModule();
    await renderHook(() => useAppBlocker(baseParams(module)));

    expect(module.start).toHaveBeenCalledWith({
      sessionId: SESSION_ID,
      endsAt: null,
      blockedCategories: ['social'],
    });
  });

  it('does not start when there is no session id', async () => {
    const module = buildFakeModule();
    await renderHook(() => useAppBlocker({ ...baseParams(module), sessionId: null }));

    expect(module.start).not.toHaveBeenCalled();
  });

  it('does not start when the session is not active', async () => {
    const module = buildFakeModule();
    await renderHook(() => useAppBlocker({ ...baseParams(module), isSessionActive: false }));

    expect(module.start).not.toHaveBeenCalled();
  });

  it('stops the module on unmount', async () => {
    const module = buildFakeModule();
    const { unmount } = await renderHook(() => useAppBlocker(baseParams(module)));

    await unmount();

    expect(module.stop).toHaveBeenCalledTimes(1);
  });

  it('stops the module when the session transitions from active to inactive', async () => {
    const module = buildFakeModule();
    const { rerender } = await renderHook((props: UseAppBlockerParams) => useAppBlocker(props), {
      initialProps: baseParams(module),
    });

    await rerender({ ...baseParams(module), isSessionActive: false });

    expect(module.stop).toHaveBeenCalledTimes(1);
  });
});

describe('useAppBlocker offline cutoff', () => {
  it('forwards offline_cutoff_reached to onOfflineTimeout', async () => {
    const module = buildFakeModule();
    const onOfflineTimeout = jest.fn();
    await renderHook(() => useAppBlocker(baseParams(module, onOfflineTimeout)));

    module.emit({
      type: 'offline_cutoff_reached',
      sessionId: SESSION_ID,
      lastConnectedAt: '2026-07-27T00:00:00.000Z',
    });

    expect(onOfflineTimeout).toHaveBeenCalledTimes(1);
  });
});

describe('useAppBlocker violation tracking', () => {
  it('surfaces a violation on permission_revoked', async () => {
    const module = buildFakeModule();
    const { result } = await renderHook(() => useAppBlocker(baseParams(module)));

    await act(async () => {
      module.emit({ type: 'permission_revoked', sessionId: SESSION_ID, permission: 'overlay' });
    });

    expect(result.current.violation).toEqual({
      state: 'violation',
      sessionId: SESSION_ID,
      reason: 'permission_revoked',
    });
  });

  it('surfaces a violation on service_killed', async () => {
    const module = buildFakeModule();
    const { result } = await renderHook(() => useAppBlocker(baseParams(module)));

    await act(async () => {
      module.emit({
        type: 'service_killed',
        sessionId: SESSION_ID,
        lastSeenAt: '2026-07-27T00:00:00.000Z',
      });
    });

    expect(result.current.violation).toEqual({
      state: 'violation',
      sessionId: SESSION_ID,
      reason: 'service_killed',
    });
  });

  it('surfaces a violation on battery_critical', async () => {
    const module = buildFakeModule();
    const { result } = await renderHook(() => useAppBlocker(baseParams(module)));

    await act(async () => {
      module.emit({ type: 'battery_critical', sessionId: SESSION_ID, level: 4 });
    });

    expect(result.current.violation).toEqual({
      state: 'violation',
      sessionId: SESSION_ID,
      reason: 'battery_critical',
    });
  });

  it('does not surface a violation for shield_triggered — blocking working as intended, not a fault', async () => {
    const module = buildFakeModule();
    const { result } = await renderHook(() => useAppBlocker(baseParams(module)));

    module.emit({
      type: 'shield_triggered',
      sessionId: SESSION_ID,
      category: 'social',
      at: '2026-07-27T00:00:00.000Z',
    });

    expect(result.current.violation).toBeNull();
  });

  it('starts with no violation', async () => {
    const module = buildFakeModule();
    const { result } = await renderHook(() => useAppBlocker(baseParams(module)));

    expect(result.current.violation).toBeNull();
  });
});

describe('useAppBlocker listener cleanup', () => {
  it('stops reacting to events after unmount', async () => {
    const module = buildFakeModule();
    const onOfflineTimeout = jest.fn();
    const { unmount } = await renderHook(() => useAppBlocker(baseParams(module, onOfflineTimeout)));

    await unmount();
    module.emit({
      type: 'offline_cutoff_reached',
      sessionId: SESSION_ID,
      lastConnectedAt: '2026-07-27T00:00:00.000Z',
    });

    expect(onOfflineTimeout).not.toHaveBeenCalled();
  });
});
