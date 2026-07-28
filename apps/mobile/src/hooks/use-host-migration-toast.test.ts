import { act, renderHook } from '@testing-library/react-native';

import { useHostMigrationToast } from './use-host-migration-toast';

// ARCHITECTURE.md §6: "Only the newly-promoted host gets a small, calm,
// few-second toast — no notification to the old host or other
// participants." session-realtime-port.ts's host_migrated Broadcast
// carries no payload (§5: Broadcast is UI-hint only, never trusted) — this
// hook instead watches the trusted host_id read via Postgres Changes
// (session.host_id, already wired through use-session.ts), and only
// treats a transition INTO the current user as a genuine promotion, never
// the initial hydration where the current user already happens to be host
// (session creator). Real timers/waits throughout — fake timers fought
// with @testing-library/react-native's own internals here, the same
// lesson learned building EmergencyExitScreen's tests.

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface HostMigrationToastProps {
  readonly hostId: string | null;
  readonly userId: string | null;
}

describe('useHostMigrationToast', () => {
  it('does not show on initial hydration even when the current user is already the host', async () => {
    const { result } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'user-1', userId: 'user-1' } },
    );

    expect(result.current).toBe(false);
  });

  it('does not show on initial hydration when the current user is not the host', async () => {
    const { result } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'other-user', userId: 'user-1' } },
    );

    expect(result.current).toBe(false);
  });

  it('shows once host_id transitions from someone else to the current user', async () => {
    const { result, rerender } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'other-user', userId: 'user-1' } },
    );
    expect(result.current).toBe(false);

    await act(async () => {
      await rerender({ hostId: 'user-1', userId: 'user-1' });
    });

    expect(result.current).toBe(true);
  });

  it('never shows for anyone other than the newly-promoted host', async () => {
    const { result, rerender } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'user-1', userId: 'user-2' } },
    );

    await act(async () => {
      await rerender({ hostId: 'user-3', userId: 'user-2' });
    });

    expect(result.current).toBe(false);
  });

  it('auto-dismisses after the toast duration', async () => {
    const { result, rerender } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'other-user', userId: 'user-1' } },
    );

    await act(async () => {
      await rerender({ hostId: 'user-1', userId: 'user-1' });
    });
    expect(result.current).toBe(true);

    await act(async () => {
      await sleep(4200);
    });

    expect(result.current).toBe(false);
  }, 10000);

  it('does not fire again for a stable, already-current host across re-renders', async () => {
    const { result, rerender } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: 'other-user', userId: 'user-1' } },
    );

    await act(async () => {
      await rerender({ hostId: 'user-1', userId: 'user-1' });
    });
    expect(result.current).toBe(true);

    await act(async () => {
      await sleep(4200);
    });
    await act(async () => {
      await rerender({ hostId: 'user-1', userId: 'user-1' });
    });

    expect(result.current).toBe(false);
  }, 10000);

  it('treats a null hostId or userId as never a promotion', async () => {
    const { result, rerender } = await renderHook(
      ({ hostId, userId }: HostMigrationToastProps) => useHostMigrationToast(hostId, userId),
      { initialProps: { hostId: null as string | null, userId: null as string | null } },
    );

    await act(async () => {
      await rerender({ hostId: 'user-1', userId: null });
    });
    expect(result.current).toBe(false);

    await act(async () => {
      await rerender({ hostId: null, userId: 'user-1' });
    });
    expect(result.current).toBe(false);
  });
});
