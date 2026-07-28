import { VENUE_SESSION_MAX_PARTICIPANTS } from '../../config/constants';
import { mintVenueQrToken } from '../venues/venue-qr-token';
import { joinVenueSession } from './join-venue-session';
import type { SessionsStore, VenueJoinOutcome } from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const VENUE_ID = '88888888-8888-8888-8888-888888888888';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const USER_ID = 'user-abc-123';

const buildFakeStore = (
  outcome: VenueJoinOutcome,
  sessionId: string | null = SESSION_ID,
): SessionsStore & {
  joinVenueCalledWith: {
    venueId: string;
    token: string;
    userId: string;
    maxParticipants: number;
  } | null;
} => {
  const store = {
    joinVenueCalledWith: null as {
      venueId: string;
      token: string;
      userId: string;
      maxParticipants: number;
    } | null,
    insertSession: jest.fn(),
    insertHostAssignment: jest.fn(),
    joinSession: jest.fn(),
    rejoinSession: jest.fn(),
    async joinVenueSession(
      venueId: string,
      token: string,
      userId: string,
      maxParticipants: number,
    ) {
      store.joinVenueCalledWith = { venueId, token, userId, maxParticipants };
      return { outcome, sessionId };
    },
    getSessionPreview: jest.fn(),
    getOpenParticipantCount: jest.fn(),
    getActiveStaticQrSessionId: jest.fn(),
    getVenueMetrics: jest.fn(),
    closeOpenInterval: jest.fn(),
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

describe('joinVenueSession', () => {
  it('rejects a malformed/tampered token without calling the store at all', async () => {
    const store = buildFakeStore('joined');

    const result = await joinVenueSession(store, QR_SECRET, { token: 'garbage', userId: USER_ID });

    expect(result).toEqual({ outcome: 'invalid_token' });
    expect(store.joinVenueCalledWith).toBeNull();
  });

  it('extracts the venue id from a well-formed token and delegates to the store using the venue capacity constant', async () => {
    const store = buildFakeStore('joined');
    const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

    const result = await joinVenueSession(store, QR_SECRET, { token, userId: USER_ID });

    expect(result).toEqual({ outcome: 'joined', sessionId: SESSION_ID });
    expect(store.joinVenueCalledWith).toEqual({
      venueId: VENUE_ID,
      token,
      userId: USER_ID,
      maxParticipants: VENUE_SESSION_MAX_PARTICIPANTS,
    });
  });

  it('passes through already_joined as a success outcome, not an error', async () => {
    const store = buildFakeStore('already_joined');
    const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

    const result = await joinVenueSession(store, QR_SECRET, { token, userId: USER_ID });

    expect(result).toEqual({ outcome: 'already_joined', sessionId: SESSION_ID });
  });

  it.each(['invalid_token', 'venue_not_found', 'no_active_session', 'at_capacity'] as const)(
    'passes through the %s failure outcome from the store',
    async (outcome) => {
      const store = buildFakeStore(outcome);
      const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

      const result = await joinVenueSession(store, QR_SECRET, { token, userId: USER_ID });

      expect(result).toEqual({ outcome });
    },
  );
});
