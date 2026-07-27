import { act, renderHook, waitFor } from '@testing-library/react-native';

// useSession composes: REST hydrate -> subscribe -> feed events into the
// SessionLifecycleMachine -> expose { session, openIntervals, status}. All
// three collaborators are mocked so this suite pins the hook's own wiring
// logic, not the collaborators (each already has its own unit suite).

const mockFetchSession = jest.fn();
const mockFetchOpenPresenceIntervals = jest.fn();
jest.mock('../services/session-repository', () => ({
  fetchSession: (...args: unknown[]) => mockFetchSession(...args),
  fetchOpenPresenceIntervals: (...args: unknown[]) => mockFetchOpenPresenceIntervals(...args),
}));

const mockUnsubscribe = jest.fn(async () => undefined);
const mockTrackPresence = jest.fn(async () => undefined);
const mockSubscribeToSessionChannel = jest.fn();
jest.mock('../services/session-channel', () => ({
  subscribeToSessionChannel: (...args: unknown[]) => mockSubscribeToSessionChannel(...args),
}));

import { useSession } from './use-session';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const SESSION_ROW = {
  id: SESSION_ID,
  host_id: 'host-1',
  venue_id: null,
  type: 'solo' as const,
  status: 'active' as const,
  duration_mode: 'fixed' as const,
  planned_duration_minutes: 30,
  started_at: '2026-07-26T00:00:00.000Z',
  ended_at: null,
  created_at: '2026-07-26T00:00:00.000Z',
};
const INTERVAL_ROW = {
  id: 'interval-1',
  session_id: SESSION_ID,
  user_id: 'host-1',
  joined_at: '2026-07-26T00:00:00.000Z',
  left_at: null,
};

describe('useSession', () => {
  beforeEach(() => {
    mockFetchSession.mockReset().mockResolvedValue({ ok: true, value: SESSION_ROW });
    mockFetchOpenPresenceIntervals.mockReset().mockResolvedValue({ ok: true, value: [INTERVAL_ROW] });
    mockUnsubscribe.mockClear();
    mockTrackPresence.mockClear();
    mockSubscribeToSessionChannel.mockReset().mockReturnValue({
      trackPresence: mockTrackPresence,
      unsubscribe: mockUnsubscribe,
    });
  });

  it('hydrates before subscribing to the channel', async () => {
    const { result } = await renderHook(() => useSession(SESSION_ID));

    await waitFor(() => expect(result.current.status).toBe('active'));

    expect(mockFetchSession).toHaveBeenCalledWith(SESSION_ID);
    expect(mockFetchOpenPresenceIntervals).toHaveBeenCalledWith(SESSION_ID);
    // subscribeToSessionChannel must not be called until AFTER hydrate
    // resolved — checked via call order, not just "was called".
    const hydrateOrder = mockFetchSession.mock.invocationCallOrder[0];
    const subscribeOrder = mockSubscribeToSessionChannel.mock.invocationCallOrder[0];
    expect(hydrateOrder).toBeDefined();
    expect(subscribeOrder).toBeDefined();
    expect(subscribeOrder as number).toBeGreaterThan(hydrateOrder as number);
  });

  it('exposes the hydrated session and open presence intervals', async () => {
    const { result } = await renderHook(() => useSession(SESSION_ID));

    await waitFor(() => expect(result.current.session).toEqual(SESSION_ROW));

    expect(result.current.openIntervals).toEqual([INTERVAL_ROW]);
  });

  it('drives the lifecycle machine to "active" when hydrated status is active', async () => {
    const { result } = await renderHook(() => useSession(SESSION_ID));

    await waitFor(() => expect(result.current.status).toBe('active'));
  });

  it('drives the lifecycle machine to "pending" when hydrated status is pending', async () => {
    mockFetchSession.mockResolvedValue({ ok: true, value: { ...SESSION_ROW, status: 'pending' } });

    const { result } = await renderHook(() => useSession(SESSION_ID));

    await waitFor(() => expect(result.current.status).toBe('pending'));
  });

  it('a Postgres Changes session row update refreshes session and advances the machine', async () => {
    const { result } = await renderHook(() => useSession(SESSION_ID));
    await waitFor(() => expect(result.current.status).toBe('active'));

    const handlers = mockSubscribeToSessionChannel.mock.calls[0]?.[1] as {
      onSessionRowChange: (payload: unknown) => void;
    };
    await act(async () => {
      handlers.onSessionRowChange({ new: { ...SESSION_ROW, status: 'completed' } });
    });

    await waitFor(() => expect(result.current.status).toBe('completed'));
    expect(result.current.session).toEqual({ ...SESSION_ROW, status: 'completed' });
  });

  it('a Broadcast host_migrated event does not itself mutate session state (UI-hint only)', async () => {
    mockFetchSession.mockResolvedValue({ ok: true, value: { ...SESSION_ROW, status: 'active' } });
    const { result } = await renderHook(() => useSession(SESSION_ID));
    await waitFor(() => expect(result.current.status).toBe('active'));

    const handlers = mockSubscribeToSessionChannel.mock.calls[0]?.[1] as {
      onBroadcast: (event: string, payload: unknown) => void;
    };
    await act(async () => {
      handlers.onBroadcast('host_migrated', { newHostId: 'user-2' });
    });

    // Broadcast is a pure hint: it must never itself change the trusted
    // `session` object — only a CDC row change or a re-fetch may
    // (.claude/skills/supabase-integration/SKILL.md).
    expect(result.current.session).toEqual({ ...SESSION_ROW, status: 'active' });
  });

  it('unsubscribes the channel on unmount — no listener leaks', async () => {
    const { unmount } = await renderHook(() => useSession(SESSION_ID));
    await waitFor(() => expect(mockSubscribeToSessionChannel).toHaveBeenCalled());

    await unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  // Phase 3 task 3.1: reportOfflineTimeout is the seam useAppBlocker forwards
  // the native-enforced 30-min offline cutoff through (ARCHITECTURE.md §4;
  // the cutoff-detection timer itself is Phase 4 backlog work — this task
  // only wires the plumbing that will consume it). useSession stays "the
  // only driver" of the machine: this exposes a send, not the actor itself.
  // CONNECTION_LOST isn't wired yet (a separate, not-yet-scheduled task), so
  // participant_reconnecting is unreachable through this hook today — this
  // asserts the currently-reachable case: 'active' has no OFFLINE_TIMEOUT
  // handler, so the call is a documented no-op, not a crash.
  it('reportOfflineTimeout is a safe no-op from a state with no handler for it', async () => {
    const { result } = await renderHook(() => useSession(SESSION_ID));
    await waitFor(() => expect(result.current.status).toBe('active'));

    await act(async () => {
      result.current.reportOfflineTimeout();
    });

    expect(result.current.status).toBe('active');
  });

  it('reportOfflineTimeout is safe to call after unmount', async () => {
    const { result, unmount } = await renderHook(() => useSession(SESSION_ID));
    await waitFor(() => expect(result.current.status).toBe('active'));

    await unmount();

    expect(() => result.current.reportOfflineTimeout()).not.toThrow();
  });
});
