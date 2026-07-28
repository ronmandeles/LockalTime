import { rejoinSession } from './rejoin-session';
import type { DisconnectReason, RejoinOutcome, SessionsStore } from './sessions-store';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const USER_ID = 'user-abc-123';

const buildFakeStore = (
  rejoinOutcome: RejoinOutcome,
): SessionsStore & {
  rejoinCalledWith: { sessionId: string; userId: string; maxParticipants: number } | null;
} => {
  const store = {
    rejoinCalledWith: null as {
      sessionId: string;
      userId: string;
      maxParticipants: number;
    } | null,
    insertSession: jest.fn(),
    insertHostAssignment: jest.fn(),
    joinSession: jest.fn(),
    async rejoinSession(sessionId: string, userId: string, maxParticipants: number) {
      store.rejoinCalledWith = { sessionId, userId, maxParticipants };
      return rejoinOutcome;
    },
    joinVenueSession: jest.fn(),
    getSessionPreview: jest.fn(),
    getOpenParticipantCount: jest.fn(),
    getActiveStaticQrSessionId: jest.fn(),
    getVenueMetrics: jest.fn(),
    closeOpenInterval: jest.fn(async (_s: string, _u: string, _r: DisconnectReason) => true),
    insertPresenceInterval: jest.fn(),
    markBlockerReady: jest.fn(),
    markDeviceTrust: jest.fn(),
    getSessionSummary: jest.fn(),
    closeAllOpenIntervals: jest.fn(),
    getPresenceIntervals: jest.fn(),
    getUserPresenceIntervals: jest.fn(),
    getFinalizedParticipantUserIds: jest.fn(),
    writeSessionParticipants: jest.fn(),
    insertRewardsHistory: jest.fn(),
    markSessionEnded: jest.fn(),
    listActiveSessions: jest.fn(),
    migrateHost: jest.fn(),
    applySessionStats: jest.fn(),
    expireStreaks: jest.fn(),
  };
  return store;
};

describe('rejoinSession', () => {
  it('delegates to the store with the session id, user id, and configured max participants', async () => {
    const store = buildFakeStore('joined');

    const result = await rejoinSession(store, { sessionId: SESSION_ID, userId: USER_ID });

    expect(result).toEqual({ outcome: 'joined' });
    expect(store.rejoinCalledWith).toEqual({
      sessionId: SESSION_ID,
      userId: USER_ID,
      maxParticipants: expect.any(Number),
    });
  });

  it('passes through already_joined as a success outcome, not an error', async () => {
    const store = buildFakeStore('already_joined');

    const result = await rejoinSession(store, { sessionId: SESSION_ID, userId: USER_ID });

    expect(result).toEqual({ outcome: 'already_joined' });
  });

  it.each(['not_found', 'not_joinable', 'not_a_participant', 'at_capacity'] as const)(
    'passes through the %s failure outcome from the store',
    async (outcome) => {
      const store = buildFakeStore(outcome);

      const result = await rejoinSession(store, { sessionId: SESSION_ID, userId: USER_ID });

      expect(result).toEqual({ outcome });
    },
  );
});
