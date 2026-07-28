import { endSession } from './end-session';
import type {
  FinalizedParticipantInput,
  PresenceIntervalRow,
  RewardsHistoryRowInput,
  SessionsStore,
  SessionSummary,
} from './sessions-store';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const HOST_ID = '55555555-5555-5555-5555-555555555555';
const START = '2026-01-01T10:00:00.000Z';
// Injectable clock (testing-standards skill) -- fixture leftAt values below
// simulate what closeAllOpenIntervals would have set to exactly this, so
// completion-bonus timing math (which uses this same `now`) stays
// consistent with the pre-set interval data instead of racing real time.
const clockAt = (iso: string) => (): Date => new Date(iso);
const DEFAULT_NOW = clockAt('2026-01-01T12:00:00.000Z');

interface FakeStoreOptions {
  readonly session: SessionSummary | null;
  readonly intervals: readonly PresenceIntervalRow[];
  readonly finalizedUserIds?: readonly string[];
}

const buildFakeStore = (
  options: FakeStoreOptions,
): SessionsStore & {
  closedAllAt: string | null;
  writtenParticipants: readonly FinalizedParticipantInput[] | null;
  writtenRewards: readonly RewardsHistoryRowInput[] | null;
  markedEnded: {
    sessionId: string;
    endedAt: string;
    endedBy: string | null;
    endReason: string;
  } | null;
} => {
  const store = {
    closedAllAt: null as string | null,
    writtenParticipants: null as readonly FinalizedParticipantInput[] | null,
    writtenRewards: null as readonly RewardsHistoryRowInput[] | null,
    markedEnded: null as {
      sessionId: string;
      endedAt: string;
      endedBy: string | null;
      endReason: string;
    } | null,
    async insertSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertHostAssignment() {},
    async joinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async rejoinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeOpenInterval(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertPresenceInterval() {},
    async markBlockerReady() {},
    async getSessionSummary() {
      return options.session;
    },
    async closeAllOpenIntervals(_sessionId: string, endedAt: string) {
      store.closedAllAt = endedAt;
    },
    async getPresenceIntervals() {
      return options.intervals;
    },
    async getUserPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getFinalizedParticipantUserIds() {
      return new Set(options.finalizedUserIds ?? []);
    },
    async writeSessionParticipants(_sessionId: string, rows: readonly FinalizedParticipantInput[]) {
      store.writtenParticipants = rows;
    },
    async insertRewardsHistory(rows: readonly RewardsHistoryRowInput[]) {
      store.writtenRewards = rows;
    },
    async markSessionEnded(input: {
      sessionId: string;
      endedAt: string;
      endedBy: string | null;
      endReason: string;
    }) {
      store.markedEnded = input;
    },
    async listActiveSessions(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async migrateHost(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

const activeSession = (overrides: Partial<SessionSummary> = {}): SessionSummary => ({
  id: SESSION_ID,
  hostId: HOST_ID,
  status: 'active',
  startedAt: START,
  ...overrides,
});

const interval = (
  userId: string,
  leftAt: string | null,
  disconnectReason: PresenceIntervalRow['disconnectReason'],
  joinedAt: string = START,
): PresenceIntervalRow => ({
  userId,
  joinedAt,
  leftAt,
  blockerReadyAt: joinedAt,
  disconnectReason,
});

describe('endSession', () => {
  it('returns not_found when the session does not exist', async () => {
    const store = buildFakeStore({ session: null, intervals: [] });

    const result = await endSession(
      store,
      SESSION_ID,
      { endedBy: HOST_ID, endReason: 'host_ended' },
      DEFAULT_NOW,
    );

    expect(result).toEqual({ outcome: 'not_found' });
  });

  it('returns not_active when the session is already completed', async () => {
    const store = buildFakeStore({
      session: activeSession({ status: 'completed' }),
      intervals: [],
    });

    const result = await endSession(
      store,
      SESSION_ID,
      { endedBy: HOST_ID, endReason: 'host_ended' },
      DEFAULT_NOW,
    );

    expect(result).toEqual({ outcome: 'not_active' });
  });

  it('returns forbidden when a non-host caller tries to end it', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [interval(HOST_ID, null, null)],
    });

    const result = await endSession(
      store,
      SESSION_ID,
      { endedBy: 'someone-else', endReason: 'host_ended' },
      DEFAULT_NOW,
    );

    expect(result).toEqual({ outcome: 'forbidden' });
  });

  it('allows a null endedBy (system-triggered close) to bypass the host check', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [interval(HOST_ID, null, null)],
    });

    const result = await endSession(
      store,
      SESSION_ID,
      { endedBy: null, endReason: 'planned_duration_reached' },
      DEFAULT_NOW,
    );

    expect(result.outcome).toBe('ended');
  });

  it('closes every open interval before reading them back', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [interval(HOST_ID, null, null)],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    expect(store.closedAllAt).not.toBeNull();
  });

  it('finalizes a still-present participant as completed', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      // Simulates the interval as already closed by closeAllOpenIntervals
      // (the fake doesn't mutate `intervals` itself -- getPresenceIntervals
      // is a separate call the real store would re-read after closing).
      intervals: [interval(HOST_ID, '2026-01-01T11:00:00.000Z', 'session_ended')],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    expect(store.writtenParticipants).toEqual([
      expect.objectContaining({ userId: HOST_ID, exitReason: 'completed', isHost: true }),
    ]);
  });

  it('finalizes a participant whose last interval was an involuntary disconnect as disconnected', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [
        interval(HOST_ID, '2026-01-01T11:00:00.000Z', 'session_ended'),
        interval('participant-1', '2026-01-01T10:20:00.000Z', 'involuntary_disconnect', START),
      ],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    const participantRow = store.writtenParticipants?.find((row) => row.userId === 'participant-1');
    expect(participantRow).toMatchObject({ exitReason: 'disconnected', isHost: false });
    expect(participantRow?.groupBonusEarned).toBe(false);
    expect(participantRow?.completionBonusEarned).toBe(false);
  });

  it('sums minutes across a rejoin and still finalizes as completed if present at the end', async () => {
    // participant-1 was present 10:00-10:20, disconnected, rejoined at
    // 10:25, and was still present when the session ended at 11:00 -- two
    // rows in session_presence_intervals for the same user (DATABASE.md:
    // a rejoin never resurrects the old interval), the newer one closed by
    // this session-end pass.
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [
        interval(HOST_ID, '2026-01-01T11:00:00.000Z', 'session_ended'),
        interval('participant-1', '2026-01-01T10:20:00.000Z', 'involuntary_disconnect', START),
        interval(
          'participant-1',
          '2026-01-01T11:00:00.000Z',
          'session_ended',
          '2026-01-01T10:25:00.000Z',
        ),
      ],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    const participantRow = store.writtenParticipants?.find((row) => row.userId === 'participant-1');
    // 20 min (10:00-10:20) + 35 min (10:25-11:00) = 55 -- base points
    // still credit every minute actually present, gap or not.
    expect(participantRow).toMatchObject({ exitReason: 'completed', totalMinutesPresent: 55 });
  });

  it('does not re-finalize a participant already finalized inline (emergency exit)', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [
        interval(HOST_ID, '2026-01-01T11:00:00.000Z', 'session_ended'),
        interval('participant-1', '2026-01-01T10:20:00.000Z', 'emergency_exit'),
      ],
      finalizedUserIds: ['participant-1'],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    expect(store.writtenParticipants).toEqual([expect.objectContaining({ userId: HOST_ID })]);
    expect(store.writtenParticipants?.some((row) => row.userId === 'participant-1')).toBe(false);
  });

  it("still counts an already-finalized participant's presence toward the group bonus timeline for others", async () => {
    // 5 concurrent for 40 min (>=30) qualifies the group bonus. One of the
    // 5 (participant-1) already emergency-exited and is pre-finalized --
    // their presence must still count toward the headcount, or the other
    // 4 would wrongly see only 4 concurrent (below the 5 floor) and lose
    // the bonus they actually earned.
    const end = '2026-01-01T10:40:00.000Z';
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [
        interval(HOST_ID, end, 'session_ended'),
        interval('b', end, 'session_ended'),
        interval('c', end, 'session_ended'),
        interval('d', end, 'session_ended'),
        interval('participant-1', end, 'emergency_exit'),
      ],
      finalizedUserIds: ['participant-1'],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    const hostRow = store.writtenParticipants?.find((row) => row.userId === HOST_ID);
    expect(hostRow?.groupBonusEarned).toBe(true);
  });

  it('writes one rewards_history row per bonus category actually earned', async () => {
    const end = '2026-01-01T11:30:00.000Z'; // 90 min, >=60 -> completion bonus too
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [
        interval(HOST_ID, end, 'session_ended'),
        interval('b', end, 'session_ended'),
        interval('c', end, 'session_ended'),
        interval('d', end, 'session_ended'),
        interval('e', end, 'session_ended'),
      ],
    });

    await endSession(
      store,
      SESSION_ID,
      { endedBy: HOST_ID, endReason: 'host_ended' },
      clockAt(end),
    );

    const hostRewardRows = store.writtenRewards?.filter((row) => row.userId === HOST_ID);
    expect(hostRewardRows?.map((row) => row.bonusType).sort()).toEqual([
      'base',
      'completion_bonus',
      'group_bonus',
    ]);
    const total = hostRewardRows?.reduce((sum, row) => sum + row.points, 0);
    const hostParticipantRow = store.writtenParticipants?.find((row) => row.userId === HOST_ID);
    expect(total).toBe(hostParticipantRow?.pointsEarned);
  });

  it('marks the session ended with the given end reason and actor', async () => {
    const store = buildFakeStore({
      session: activeSession(),
      intervals: [interval(HOST_ID, '2026-01-01T11:00:00.000Z', 'session_ended')],
    });

    await endSession(store, SESSION_ID, { endedBy: HOST_ID, endReason: 'host_ended' }, DEFAULT_NOW);

    expect(store.markedEnded).toMatchObject({
      sessionId: SESSION_ID,
      endedBy: HOST_ID,
      endReason: 'host_ended',
    });
  });

  it('skips finalization entirely for a session with no presence intervals at all', async () => {
    const store = buildFakeStore({ session: activeSession(), intervals: [] });

    const result = await endSession(
      store,
      SESSION_ID,
      { endedBy: HOST_ID, endReason: 'host_ended' },
      DEFAULT_NOW,
    );

    expect(result.outcome).toBe('ended');
    expect(store.writtenParticipants).toEqual([]);
    expect(store.writtenRewards).toEqual([]);
  });
});
