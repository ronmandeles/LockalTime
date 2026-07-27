import { runSweep } from './sweep';
import { buildFakeSessionsStore } from './test-support/fake-sessions-store';
import type { FakeInterval, FakeSession } from './test-support/fake-sessions-store';
import type { SessionRealtimePort } from './session-realtime-port';

const NOW = new Date('2026-01-01T12:00:00.000Z');
const addMinutes = (date: Date, n: number): string =>
  new Date(date.getTime() + n * 60_000).toISOString();
const addSeconds = (date: Date, n: number): string =>
  new Date(date.getTime() + n * 1000).toISOString();
const clock = () => NOW;

const buildFakeRealtimePort = (
  lastSeenBySession: Record<string, Record<string, string>> = {},
): SessionRealtimePort & { tracked: Set<string>; broadcasts: string[] } => {
  const tracked = new Set<string>();
  const broadcasts: string[] = [];
  return {
    tracked,
    broadcasts,
    track: (sessionId: string) => {
      tracked.add(sessionId);
    },
    untrack: (sessionId: string) => {
      tracked.delete(sessionId);
    },
    lastSeenAt: (sessionId: string) => {
      const entries = lastSeenBySession[sessionId] ?? {};
      return new Map(Object.entries(entries).map(([userId, iso]) => [userId, new Date(iso)]));
    },
    broadcastHostMigrated: async (sessionId: string) => {
      broadcasts.push(sessionId);
    },
  };
};

const fixedSession = (overrides: Partial<FakeSession> = {}): FakeSession => ({
  id: 'session-1',
  hostId: 'host-1',
  status: 'active',
  durationMode: 'fixed',
  plannedDurationMinutes: 30,
  startedAt: addMinutes(NOW, -30),
  ...overrides,
});

const interval = (
  overrides: Partial<FakeInterval> & { sessionId: string; userId: string },
): FakeInterval => ({
  joinedAt: NOW.toISOString(),
  leftAt: null,
  blockerReadyAt: null,
  disconnectReason: null,
  ...overrides,
});

describe('runSweep — auto-close', () => {
  it('force-closes a fixed-duration session once planned_duration_minutes has elapsed', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ startedAt: addMinutes(NOW, -30), plannedDurationMinutes: 30 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -30) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    const session = store.state.sessions[0];
    expect(session?.status).toBe('completed');
    expect(session?.endReason).toBe('planned_duration_reached');
    expect(session?.endedBy).toBeNull();
  });

  it('leaves a fixed-duration session untouched before its planned duration elapses', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ startedAt: addMinutes(NOW, -29), plannedDurationMinutes: 30 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -29) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.status).toBe('active');
  });

  it('force-terminates an open-ended session once it exceeds the 24h cap', async () => {
    const store = buildFakeSessionsStore({
      sessions: [
        fixedSession({
          durationMode: 'open_ended',
          plannedDurationMinutes: null,
          startedAt: addMinutes(NOW, -24 * 60 - 1),
        }),
      ],
      intervals: [
        interval({
          sessionId: 'session-1',
          userId: 'host-1',
          joinedAt: addMinutes(NOW, -24 * 60 - 1),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    const session = store.state.sessions[0];
    expect(session?.status).toBe('completed');
    expect(session?.endReason).toBe('force_terminated');
  });

  it('leaves an open-ended session untouched before the 24h cap', async () => {
    const store = buildFakeSessionsStore({
      sessions: [
        fixedSession({
          durationMode: 'open_ended',
          plannedDurationMinutes: null,
          startedAt: addMinutes(NOW, -23 * 60),
        }),
      ],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -23 * 60) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.status).toBe('active');
  });

  it('untracks a session from the realtime port once it auto-closes', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ startedAt: addMinutes(NOW, -30), plannedDurationMinutes: 30 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -30) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    expect(realtime.tracked.has('session-1')).toBe(false);
  });
});

describe('runSweep — host migration', () => {
  it('promotes the only other present participant once the host is absent >= 20s', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -10) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -5),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': { 'host-1': addSeconds(NOW, -21), 'participant-1': addSeconds(NOW, -1) },
    });

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.hostId).toBe('participant-1');
    expect(realtime.broadcasts).toEqual(['session-1']);
  });

  it('does not migrate when the host has been absent under 20s', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -10) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -5),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': { 'host-1': addSeconds(NOW, -19), 'participant-1': addSeconds(NOW, -1) },
    });

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.hostId).toBe('host-1');
    expect(realtime.broadcasts).toEqual([]);
  });

  it('leaves the session as host_disconnected (no mutation) when nobody else is present to promote', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -10) }),
      ],
    });
    const realtime = buildFakeRealtimePort({ 'session-1': { 'host-1': addSeconds(NOW, -30) } });

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.hostId).toBe('host-1');
    expect(realtime.broadcasts).toEqual([]);
  });

  it('promotes whoever has the highest cumulative minutes present, not just the longest current interval', async () => {
    // participant-1: an earlier 40-minute interval (closed) + a brief
    // 2-minute current one = 42 cumulative minutes.
    // participant-2: one long-looking current interval, but only 10
    // minutes so far.
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -50) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -50),
          leftAt: addMinutes(NOW, -10),
          disconnectReason: 'involuntary_disconnect',
        }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -2),
        }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-2',
          joinedAt: addMinutes(NOW, -10),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': {
        'host-1': addSeconds(NOW, -30),
        'participant-1': addSeconds(NOW, -1),
        'participant-2': addSeconds(NOW, -1),
      },
    });

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.hostId).toBe('participant-1');
  });

  it('breaks a genuine tie in cumulative minutes by earliest current joinedAt', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -20) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -10),
        }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-2',
          joinedAt: addMinutes(NOW, -10),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': {
        'host-1': addSeconds(NOW, -30),
        'participant-1': addSeconds(NOW, -1),
        'participant-2': addSeconds(NOW, -1),
      },
    });

    await runSweep({ store, realtime, now: clock });

    // Exactly tied (both joined -10min) -- reduce()'s "candidate < best"
    // strict-less-than tie-break keeps the first-encountered (participant-1,
    // array order), deterministic either way.
    expect(store.state.sessions[0]?.hostId).toBe('participant-1');
  });

  it('excludes a participant reconciled away as stale in the same sweep pass from migration candidates', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -20) }),
        // participant-1 has an open interval but hasn't been seen in
        // presence for 35 min -- reconciliation will close them as
        // involuntary_disconnect BEFORE migration runs, so they must not
        // be promoted even though they technically had an open interval
        // at the start of this sweep tick.
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -40),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': { 'host-1': addSeconds(NOW, -30) }, // participant-1 never seen at all
    });

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions[0]?.hostId).toBe('host-1'); // no valid candidate left
    const participant1Interval = store.state.intervals.find(
      (row) => row.userId === 'participant-1',
    );
    expect(participant1Interval?.disconnectReason).toBe('involuntary_disconnect');
  });
});

describe('runSweep — stale-participant reconciliation', () => {
  it('closes a non-host participant interval after 30 minutes of presence absence', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -40) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -40),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': { 'host-1': addSeconds(NOW, -1), 'participant-1': addMinutes(NOW, -30) },
    });

    await runSweep({ store, realtime, now: clock });

    const participantInterval = store.state.intervals.find((row) => row.userId === 'participant-1');
    expect(participantInterval?.leftAt).not.toBeNull();
    expect(participantInterval?.disconnectReason).toBe('involuntary_disconnect');
  });

  it('does not close a participant absent under 30 minutes', async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -40) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -29),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({
      'session-1': { 'host-1': addSeconds(NOW, -1), 'participant-1': addMinutes(NOW, -29) },
    });

    await runSweep({ store, realtime, now: clock });

    const participantInterval = store.state.intervals.find((row) => row.userId === 'participant-1');
    expect(participantInterval?.leftAt).toBeNull();
  });

  it('falls back to joinedAt when a participant has never appeared in a presence sync yet', async () => {
    // Just joined 1 minute ago, presence hasn't synced yet at all -- must
    // NOT be treated as infinitely absent (which would instantly reconcile
    // them away seconds after joining).
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -40) }),
        interval({
          sessionId: 'session-1',
          userId: 'participant-1',
          joinedAt: addMinutes(NOW, -1),
        }),
      ],
    });
    const realtime = buildFakeRealtimePort({ 'session-1': { 'host-1': addSeconds(NOW, -1) } });

    await runSweep({ store, realtime, now: clock });

    const participantInterval = store.state.intervals.find((row) => row.userId === 'participant-1');
    expect(participantInterval?.leftAt).toBeNull();
  });

  it("never reconciles the host through the stale-participant path (host absence is migration's concern)", async () => {
    const store = buildFakeSessionsStore({
      sessions: [fixedSession({ plannedDurationMinutes: 999 })],
      intervals: [
        interval({ sessionId: 'session-1', userId: 'host-1', joinedAt: addMinutes(NOW, -40) }),
      ],
    });
    const realtime = buildFakeRealtimePort({ 'session-1': { 'host-1': addMinutes(NOW, -35) } });

    await runSweep({ store, realtime, now: clock });

    const hostInterval = store.state.intervals.find((row) => row.userId === 'host-1');
    expect(hostInterval?.leftAt).toBeNull();
  });
});

describe('runSweep — multiple sessions', () => {
  it('handles each active session independently in one pass', async () => {
    const store = buildFakeSessionsStore({
      sessions: [
        fixedSession({
          id: 'session-a',
          hostId: 'host-a',
          startedAt: addMinutes(NOW, -30),
          plannedDurationMinutes: 30,
        }),
        fixedSession({
          id: 'session-b',
          hostId: 'host-b',
          startedAt: addMinutes(NOW, -5),
          plannedDurationMinutes: 30,
        }),
      ],
      intervals: [
        interval({ sessionId: 'session-a', userId: 'host-a', joinedAt: addMinutes(NOW, -30) }),
        interval({ sessionId: 'session-b', userId: 'host-b', joinedAt: addMinutes(NOW, -5) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    expect(store.state.sessions.find((row) => row.id === 'session-a')?.status).toBe('completed');
    expect(store.state.sessions.find((row) => row.id === 'session-b')?.status).toBe('active');
  });

  it('tracks every still-active session with the realtime port', async () => {
    const store = buildFakeSessionsStore({
      sessions: [
        fixedSession({
          id: 'session-a',
          hostId: 'host-a',
          startedAt: addMinutes(NOW, -5),
          plannedDurationMinutes: 30,
        }),
        fixedSession({
          id: 'session-b',
          hostId: 'host-b',
          startedAt: addMinutes(NOW, -5),
          plannedDurationMinutes: 30,
        }),
      ],
      intervals: [
        interval({ sessionId: 'session-a', userId: 'host-a', joinedAt: addMinutes(NOW, -5) }),
        interval({ sessionId: 'session-b', userId: 'host-b', joinedAt: addMinutes(NOW, -5) }),
      ],
    });
    const realtime = buildFakeRealtimePort();

    await runSweep({ store, realtime, now: clock });

    expect(realtime.tracked).toEqual(new Set(['session-a', 'session-b']));
  });
});
