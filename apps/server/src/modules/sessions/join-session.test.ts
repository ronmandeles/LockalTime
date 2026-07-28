import { joinSession } from './join-session';
import { mintQrToken } from './qr-token';
import type { DisconnectReason, JoinOutcome, SessionsStore } from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const USER_ID = 'user-abc-123';

const buildFakeStore = (
  joinOutcome: JoinOutcome,
): SessionsStore & {
  joinCalledWith: {
    sessionId: string;
    userId: string;
    token: string;
    maxParticipants: number;
  } | null;
} => {
  const store = {
    joinCalledWith: null as {
      sessionId: string;
      userId: string;
      token: string;
      maxParticipants: number;
    } | null,
    insertSession: jest.fn(),
    insertHostAssignment: jest.fn(),
    async joinSession(sessionId: string, userId: string, token: string, maxParticipants: number) {
      store.joinCalledWith = { sessionId, userId, token, maxParticipants };
      return joinOutcome;
    },
    async rejoinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    closeOpenInterval: jest.fn(async (_s: string, _u: string, _r: DisconnectReason) => true),
    insertPresenceInterval: jest.fn(),
    markBlockerReady: jest.fn(),
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

describe('joinSession', () => {
  it('rejects a malformed/tampered token without calling the store at all', async () => {
    const store = buildFakeStore('joined');

    const result = await joinSession(store, QR_SECRET, { token: 'garbage', userId: USER_ID });

    expect(result).toEqual({ outcome: 'invalid_token' });
    expect(store.joinCalledWith).toBeNull();
  });

  it('extracts the session id from a well-formed token and delegates to the store', async () => {
    const store = buildFakeStore('joined');
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await joinSession(store, QR_SECRET, { token, userId: USER_ID });

    expect(result).toEqual({ outcome: 'joined', sessionId: SESSION_ID });
    expect(store.joinCalledWith).toEqual({
      sessionId: SESSION_ID,
      userId: USER_ID,
      token,
      maxParticipants: expect.any(Number),
    });
  });

  it('passes through already_joined as a success outcome, not an error', async () => {
    const store = buildFakeStore('already_joined');
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await joinSession(store, QR_SECRET, { token, userId: USER_ID });

    expect(result).toEqual({ outcome: 'already_joined', sessionId: SESSION_ID });
  });

  it.each(['not_found', 'not_joinable', 'expired', 'at_capacity'] as const)(
    'passes through the %s failure outcome from the store',
    async (outcome) => {
      const store = buildFakeStore(outcome);
      const token = mintQrToken(SESSION_ID, QR_SECRET);

      const result = await joinSession(store, QR_SECRET, { token, userId: USER_ID });

      expect(result).toEqual({ outcome });
    },
  );
});
