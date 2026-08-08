import { COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS } from '../../config/constants';
import { mintVenueQrToken } from '../venues/venue-qr-token';
import type { VenueRecord, VenuesStore } from '../venues/venues-store';
import { previewSession } from './preview-session';
import { mintQrToken } from './qr-token';
import type { SessionPreviewRow, SessionsStore } from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const VENUE_ID = '88888888-8888-8888-8888-888888888888';

const NOW = new Date('2026-07-29T12:00:00.000Z');
const now = (): Date => NOW;

const buildFakeSessionsStore = (
  overrides: Partial<{
    preview: SessionPreviewRow | null;
    participantCount: number;
    activeStaticQrSessionId: string | null;
  }> = {},
): SessionsStore => {
  const store: Partial<SessionsStore> = {
    async getSessionPreview() {
      return overrides.preview ?? null;
    },
    async getOpenParticipantCount() {
      return overrides.participantCount ?? 0;
    },
    async getActiveStaticQrSessionId() {
      return overrides.activeStaticQrSessionId ?? null;
    },
  };
  return store as SessionsStore;
};

const buildFakeVenuesStore = (venues: Record<string, VenueRecord> = {}): VenuesStore => ({
  async createVenue(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async listVenuesForOwner(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async getVenueById(id) {
    return venues[id] ?? null;
  },
  async regenerateQrToken(): Promise<never> {
    throw new Error('not used in these tests');
  },
});

const VENUE: VenueRecord = {
  id: VENUE_ID,
  ownerId: 'host-1',
  name: "Joe's Cafe",
  addressLabel: null,
  qrToken: 'venue-token',
  qrTokenIssuedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
  approvedBlockedCategories: ['social', 'games', 'entertainment'],
  approvedBlockedPackages: [],
};

describe('previewSession', () => {
  it('rejects a malformed/tampered token without consulting any store', async () => {
    const sessionsStore = buildFakeSessionsStore();
    const venuesStore = buildFakeVenuesStore();

    const result = await previewSession(sessionsStore, venuesStore, QR_SECRET, 'garbage', now);

    expect(result).toEqual({ outcome: 'invalid_token' });
  });

  it('previews a session reached via a session token, computing elapsed minutes and completion-bonus availability', async () => {
    const startedAt = new Date(NOW.getTime() - 5 * 60_000).toISOString();
    const sessionsStore = buildFakeSessionsStore({
      preview: {
        id: SESSION_ID,
        type: 'dynamic_qr',
        durationMode: 'fixed',
        plannedDurationMinutes: 30,
        status: 'active',
        startedAt,
        venueId: null,
        blockedCategories: ['social', 'games', 'entertainment'],
        blockedPackages: [],
      },
      participantCount: 4,
    });
    const venuesStore = buildFakeVenuesStore();
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await previewSession(sessionsStore, venuesStore, QR_SECRET, token, now);

    expect(result).toEqual({
      outcome: 'ok',
      preview: {
        sessionId: SESSION_ID,
        tokenKind: 'session',
        type: 'dynamic_qr',
        durationMode: 'fixed',
        plannedDurationMinutes: 30,
        status: 'active',
        startedAt,
        elapsedMinutes: 5,
        participantCount: 4,
        venueName: null,
        completionBonusAvailable: false,
        blockedCategories: ['social', 'games', 'entertainment'],
        blockedPackages: [],
      },
    });
  });

  it('reports completion_bonus_available true when joining now is still within tolerance', async () => {
    const startedAt = new Date(
      NOW.getTime() - (COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS - 5) * 1000,
    ).toISOString();
    const sessionsStore = buildFakeSessionsStore({
      preview: {
        id: SESSION_ID,
        type: 'solo',
        durationMode: 'open_ended',
        plannedDurationMinutes: null,
        status: 'active',
        startedAt,
        venueId: null,
        blockedCategories: ['social', 'games', 'entertainment'],
        blockedPackages: [],
      },
      participantCount: 1,
    });
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await previewSession(
      sessionsStore,
      buildFakeVenuesStore(),
      QR_SECRET,
      token,
      now,
    );

    expect(result.outcome).toBe('ok');
    expect(result.outcome === 'ok' && result.preview.completionBonusAvailable).toBe(true);
  });

  it('reports elapsedMinutes/completionBonusAvailable as null/false for a session that has not started', async () => {
    const sessionsStore = buildFakeSessionsStore({
      preview: {
        id: SESSION_ID,
        type: 'solo',
        durationMode: 'fixed',
        plannedDurationMinutes: 30,
        status: 'pending',
        startedAt: null,
        venueId: null,
        blockedCategories: ['social', 'games', 'entertainment'],
        blockedPackages: [],
      },
      participantCount: 0,
    });
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await previewSession(
      sessionsStore,
      buildFakeVenuesStore(),
      QR_SECRET,
      token,
      now,
    );

    expect(result.outcome).toBe('ok');
    expect(result.outcome === 'ok' && result.preview.elapsedMinutes).toBeNull();
    expect(result.outcome === 'ok' && result.preview.completionBonusAvailable).toBe(false);
  });

  it('returns session_not_found when the token verifies but the session row is gone', async () => {
    const sessionsStore = buildFakeSessionsStore({ preview: null });
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await previewSession(
      sessionsStore,
      buildFakeVenuesStore(),
      QR_SECRET,
      token,
      now,
    );

    expect(result).toEqual({ outcome: 'session_not_found' });
  });

  it('resolves venue_name for a session tied to a venue', async () => {
    const sessionsStore = buildFakeSessionsStore({
      preview: {
        id: SESSION_ID,
        type: 'static_qr',
        durationMode: 'open_ended',
        plannedDurationMinutes: null,
        status: 'active',
        startedAt: NOW.toISOString(),
        venueId: VENUE_ID,
        blockedCategories: ['social', 'games', 'entertainment'],
        blockedPackages: [],
      },
      participantCount: 12,
    });
    const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: VENUE });
    const token = mintQrToken(SESSION_ID, QR_SECRET);

    const result = await previewSession(sessionsStore, venuesStore, QR_SECRET, token, now);

    expect(result.outcome).toBe('ok');
    expect(result.outcome === 'ok' && result.preview.venueName).toBe("Joe's Cafe");
  });

  describe('via a venue token', () => {
    it('resolves the venue then its active session and previews that', async () => {
      const sessionsStore = buildFakeSessionsStore({
        activeStaticQrSessionId: SESSION_ID,
        preview: {
          id: SESSION_ID,
          type: 'static_qr',
          durationMode: 'open_ended',
          plannedDurationMinutes: null,
          status: 'active',
          startedAt: NOW.toISOString(),
          venueId: VENUE_ID,
          blockedCategories: ['social', 'games', 'entertainment'],
          blockedPackages: [],
        },
        participantCount: 3,
      });
      const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: VENUE });
      const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

      const result = await previewSession(sessionsStore, venuesStore, QR_SECRET, token, now);

      expect(result.outcome).toBe('ok');
      expect(result.outcome === 'ok' && result.preview.sessionId).toBe(SESSION_ID);
      expect(result.outcome === 'ok' && result.preview.venueName).toBe("Joe's Cafe");
      expect(result.outcome === 'ok' && result.preview.tokenKind).toBe('venue');
    });

    it('returns venue_not_found for a venue token naming a venue that no longer exists', async () => {
      const sessionsStore = buildFakeSessionsStore();
      const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

      const result = await previewSession(
        sessionsStore,
        buildFakeVenuesStore(),
        QR_SECRET,
        token,
        now,
      );

      expect(result).toEqual({ outcome: 'venue_not_found' });
    });

    it('returns no_active_session for a real venue with nothing currently running', async () => {
      const sessionsStore = buildFakeSessionsStore({ activeStaticQrSessionId: null });
      const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: VENUE });
      const token = mintVenueQrToken(VENUE_ID, QR_SECRET);

      const result = await previewSession(sessionsStore, venuesStore, QR_SECRET, token, now);

      expect(result).toEqual({ outcome: 'no_active_session' });
    });
  });
});
