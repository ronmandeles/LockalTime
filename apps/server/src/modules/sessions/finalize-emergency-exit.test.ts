import { finalizeEmergencyExit } from './finalize-emergency-exit';
import type {
  FinalizedParticipantInput,
  PresenceIntervalRow,
  RewardsHistoryRowInput,
  SessionsStore,
  SessionSummary,
} from './sessions-store';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const HOST_ID = '55555555-5555-5555-5555-555555555555';
const USER_ID = 'participant-1';

const buildFakeStore = (
  session: SessionSummary | null,
  intervals: readonly PresenceIntervalRow[],
): SessionsStore & {
  writtenParticipants: readonly FinalizedParticipantInput[] | null;
  writtenRewards: readonly RewardsHistoryRowInput[] | null;
  appliedStats: { sessionId: string; userId: string; finalizedAt: string }[];
} => {
  const store = {
    writtenParticipants: null as readonly FinalizedParticipantInput[] | null,
    writtenRewards: null as readonly RewardsHistoryRowInput[] | null,
    appliedStats: [] as { sessionId: string; userId: string; finalizedAt: string }[],
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
    async joinVenueSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getSessionPreview(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getOpenParticipantCount(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getActiveStaticQrSessionId(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getVenueMetrics(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeOpenInterval(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertPresenceInterval() {},
    async markBlockerReady() {},
    async markDeviceTrust() {},
    async getSessionSummary() {
      return session;
    },
    async closeAllOpenIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getUserPresenceIntervals() {
      return intervals;
    },
    async getFinalizedParticipantUserIds(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async writeSessionParticipants(_sessionId: string, rows: readonly FinalizedParticipantInput[]) {
      store.writtenParticipants = rows;
    },
    async insertRewardsHistory(rows: readonly RewardsHistoryRowInput[]) {
      store.writtenRewards = rows;
    },
    async markSessionEnded(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async listActiveSessions(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async migrateHost(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async applySessionStats(sessionId: string, userId: string, finalizedAt: string) {
      store.appliedStats.push({ sessionId, userId, finalizedAt });
    },
    async expireStreaks(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

const session: SessionSummary = {
  id: SESSION_ID,
  hostId: HOST_ID,
  status: 'active',
  startedAt: '2026-01-01T10:00:00.000Z',
};

const interval = (joinedAt: string, leftAt: string): PresenceIntervalRow => ({
  userId: USER_ID,
  joinedAt,
  leftAt,
  blockerReadyAt: joinedAt,
  disconnectReason: 'emergency_exit',
  deviceTrustTier: 'trusted',
});

describe('finalizeEmergencyExit', () => {
  it('writes base-only points, forfeiting both bonuses, for minutes actually present', async () => {
    const store = buildFakeStore(session, [
      interval('2026-01-01T10:00:00.000Z', '2026-01-01T10:23:00.000Z'),
    ]);

    await finalizeEmergencyExit(store, SESSION_ID, USER_ID);

    expect(store.writtenParticipants).toEqual([
      {
        userId: USER_ID,
        isHost: false,
        exitReason: 'emergency_exit',
        totalMinutesPresent: 23,
        groupBonusEarned: false,
        completionBonusEarned: false,
        pointsEarned: 23,
        deviceTrustTier: 'trusted',
      },
    ]);
  });

  it('sums minutes across a prior rejoin before the emergency exit', async () => {
    const store = buildFakeStore(session, [
      interval('2026-01-01T10:00:00.000Z', '2026-01-01T10:10:00.000Z'),
      interval('2026-01-01T10:15:00.000Z', '2026-01-01T10:20:00.000Z'),
    ]);

    await finalizeEmergencyExit(store, SESSION_ID, USER_ID);

    expect(store.writtenParticipants?.[0]?.totalMinutesPresent).toBe(15);
  });

  it('marks isHost true when the exiting user is the session host', async () => {
    const store = buildFakeStore(session, [
      interval('2026-01-01T10:00:00.000Z', '2026-01-01T10:05:00.000Z'),
    ]);

    await finalizeEmergencyExit(store, SESSION_ID, HOST_ID);

    expect(store.writtenParticipants?.[0]?.isHost).toBe(true);
  });

  it('writes exactly one base rewards_history row, no bonus rows', async () => {
    const store = buildFakeStore(session, [
      interval('2026-01-01T10:00:00.000Z', '2026-01-01T10:23:00.000Z'),
    ]);

    await finalizeEmergencyExit(store, SESSION_ID, USER_ID);

    expect(store.writtenRewards).toEqual([
      { userId: USER_ID, sessionId: SESSION_ID, points: 23, bonusType: 'base' },
    ]);
  });

  it('applies gamification stats immediately, using the injected clock', async () => {
    const store = buildFakeStore(session, [
      interval('2026-01-01T10:00:00.000Z', '2026-01-01T10:23:00.000Z'),
    ]);

    await finalizeEmergencyExit(
      store,
      SESSION_ID,
      USER_ID,
      () => new Date('2026-01-01T10:23:00.000Z'),
    );

    expect(store.appliedStats).toEqual([
      {
        sessionId: SESSION_ID,
        userId: USER_ID,
        finalizedAt: '2026-01-01T10:23:00.000Z',
      },
    ]);
  });
});
