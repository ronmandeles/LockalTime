import express from 'express';
import request from 'supertest';

import { createRequireAuth } from '../../middleware/require-auth';
import { errorHandler } from '../../middleware/error-handler';
import { unconfiguredAttestationProvider } from '../attestation/attestation-provider';
import type { AttestationStore, RecordAttestationInput } from '../attestation/attestation-store';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import type { VenueRecord, VenuesStore } from '../venues/venues-store';
import { mintQrToken, verifyQrToken } from './qr-token';
import { createSessionsRouter } from './sessions.router';
import type {
  HostAssignmentReason,
  NewSessionInput,
  SessionRecord,
  SessionsStore,
} from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const HOST_ID = 'user-abc-123';

const buildFakeAttestationStore = (): AttestationStore & { recorded: RecordAttestationInput[] } => {
  const store = {
    recorded: [] as RecordAttestationInput[],
    async recordAttestation(input: RecordAttestationInput): Promise<void> {
      store.recorded.push(input);
    },
  };
  return store;
};

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const mintAuthToken = async (sub: string) => jwks.mintToken({ sub });

const buildFakeStore = (): SessionsStore & {
  insertedSession: NewSessionInput | null;
  hostAssignment: { sessionId: string; userId: string; reason: HostAssignmentReason } | null;
} => {
  const store = {
    insertedSession: null as NewSessionInput | null,
    hostAssignment: null as {
      sessionId: string;
      userId: string;
      reason: HostAssignmentReason;
    } | null,
    async insertSession(input: NewSessionInput): Promise<SessionRecord> {
      store.insertedSession = input;
      return {
        id: input.id,
        hostId: input.hostId,
        venueId: input.venueId,
        type: input.type,
        status: input.status,
        durationMode: input.durationMode,
        plannedDurationMinutes: input.plannedDurationMinutes,
        qrToken: input.qrToken,
        qrExpiresAt: input.qrExpiresAt,
        startedAt: input.startedAt,
        createdAt: '2026-07-26T00:00:00.000Z',
      };
    },
    async insertHostAssignment(
      sessionId: string,
      userId: string,
      reason: HostAssignmentReason,
    ): Promise<void> {
      store.hostAssignment = { sessionId, userId, reason };
    },
    async insertPresenceInterval(): Promise<void> {},
    async markBlockerReady(): Promise<void> {},
    async markDeviceTrust(): Promise<void> {},
    // Not exercised by these tests — present only to satisfy the
    // SessionsStore interface.
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
    async getSessionSummary(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeAllOpenIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getUserPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getFinalizedParticipantUserIds(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async writeSessionParticipants(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertRewardsHistory(): Promise<never> {
      throw new Error('not used in these tests');
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
    async applySessionStats(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async expireStreaks(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

// Phase 6 task 1: a venue lookup keyed by id -> owner_id, so the ownership
// check has something real to consult. Empty by default — every existing
// test in this file never sends venue_id, so getVenueById is simply never
// called for them.
const buildFakeVenuesStore = (venueOwners: Record<string, string> = {}): VenuesStore => ({
  async createVenue(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async listVenuesForOwner(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async getVenueById(id) {
    const ownerId = venueOwners[id];
    if (ownerId === undefined) {
      return null;
    }
    const record: VenueRecord = {
      id,
      ownerId,
      name: 'Test Venue',
      addressLabel: null,
      qrToken: 'fixture-venue-qr-token',
      qrTokenIssuedAt: '2026-07-29T00:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    return record;
  },
  async regenerateQrToken(): Promise<never> {
    throw new Error('not used in these tests');
  },
});

const buildApp = (
  store: SessionsStore,
  attestationStore: AttestationStore = buildFakeAttestationStore(),
  venuesStore: VenuesStore = buildFakeVenuesStore(),
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/sessions',
    createSessionsRouter({
      store,
      qrSigningSecret: QR_SECRET,
      requireAuth: createRequireAuth(jwks.getKey),
      attestationProvider: unconfiguredAttestationProvider,
      attestationStore,
      venuesStore,
    }),
  );
  app.use(errorHandler);
  return app;
};

describe('POST /sessions', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(response.status).toBe(401);
  });

  it('rejects an invalid type', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'not-a-real-type', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('rejects a fixed-duration session with no planned_duration_minutes', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'fixed' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  // Phase 7 code-review finding: AppBlockerModule.swift's scheduleMonitoring
  // extracts only the hour/minute/second components of the session's start
  // and end times (DeviceActivitySchedule models a time-of-day window, not
  // an absolute duration) -- so a session longer than 24h is silently
  // truncated to (duration mod 24h) on iOS, firing the extension's
  // guaranteed shield-clearing cleanup far too early. That Swift code's own
  // comment already assumed "fixed sessions are bounded by product design"
  // -- this cap is what actually makes that assumption true, matching
  // OPEN_ENDED_SESSION_MAX_HOURS' existing 24h bound for open-ended sessions.
  it('rejects a fixed-duration session whose planned_duration_minutes exceeds 24 hours', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 1441 });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('accepts a fixed-duration session at exactly the 24-hour cap', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 1440 });

    expect(response.status).toBe(201);
  });

  it('creates a solo session with no QR token', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(response.status).toBe(201);
    expect(response.body.qrToken).toBeNull();
    expect(response.body.hostId).toBe(HOST_ID);
  });

  it('creates a dynamic_qr session with a verifiable token', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'fixed', planned_duration_minutes: 45 });

    expect(response.status).toBe(201);
    expect(verifyQrToken(response.body.qrToken, QR_SECRET)).toEqual({
      sessionId: response.body.id,
    });
  });

  it('records a device attestation when the request includes one, and never blocks creation without one', async () => {
    const token = await mintAuthToken(HOST_ID);
    const attestationStore = buildFakeAttestationStore();

    const withAttestation = await request(buildApp(buildFakeStore(), attestationStore))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        attestation: { platform: 'android', token: 'device-attestation-token' },
      });
    expect(withAttestation.status).toBe(201);
    expect(attestationStore.recorded).toHaveLength(1);
    expect(attestationStore.recorded[0]).toMatchObject({
      userId: HOST_ID,
      sessionId: withAttestation.body.id,
      platform: 'android',
      action: 'create',
      verdict: 'not_configured',
    });

    const withoutAttestation = await request(buildApp(buildFakeStore(), attestationStore))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });
    expect(withoutAttestation.status).toBe(201);
    expect(attestationStore.recorded).toHaveLength(1);
  });

  it('creates an open-ended session with no planned duration', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({ type: 'solo', duration_mode: 'open_ended' });

    expect(response.status).toBe(201);
    expect(response.body.durationMode).toBe('open_ended');
  });

  it('ignores a client-supplied host_id — the session is always hosted by the authenticated user', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        host_id: 'someone-elses-id',
      });

    expect(response.status).toBe(201);
    expect(response.body.hostId).toBe(HOST_ID);
  });
});

describe('POST /sessions — venue ownership (Phase 6 task 1)', () => {
  const VENUE_ID = '99999999-9999-9999-9999-999999999999';

  it('creates a session tagged to a venue the host owns', async () => {
    const token = await mintAuthToken(HOST_ID);
    const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: HOST_ID });

    const response = await request(
      buildApp(buildFakeStore(), buildFakeAttestationStore(), venuesStore),
    )
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'dynamic_qr',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        venue_id: VENUE_ID,
      });

    expect(response.status).toBe(201);
    expect(response.body.venueId).toBe(VENUE_ID);
  });

  it('rejects a venue_id the host does not own', async () => {
    const token = await mintAuthToken(HOST_ID);
    const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: 'someone-elses-id' });

    const response = await request(
      buildApp(buildFakeStore(), buildFakeAttestationStore(), venuesStore),
    )
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'dynamic_qr',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        venue_id: VENUE_ID,
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('venue_not_owned');
  });

  it('rejects a venue_id that does not exist', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore()))
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'dynamic_qr',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        venue_id: VENUE_ID,
      });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('venue_not_found');
  });

  it('applies the ownership check to solo/dynamic_qr sessions too, not just static_qr', async () => {
    const token = await mintAuthToken(HOST_ID);
    const venuesStore = buildFakeVenuesStore({ [VENUE_ID]: 'someone-elses-id' });

    const response = await request(
      buildApp(buildFakeStore(), buildFakeAttestationStore(), venuesStore),
    )
      .post('/sessions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        venue_id: VENUE_ID,
      });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('venue_not_owned');
  });
});

describe('POST /sessions/preview (Phase 6 task 4)', () => {
  const PREVIEW_SESSION_ID = '55555555-1111-1111-1111-111111111111';

  const buildPreviewStore = (
    overrides: Partial<{
      getSessionPreview: SessionsStore['getSessionPreview'];
      getOpenParticipantCount: SessionsStore['getOpenParticipantCount'];
    }> = {},
  ): SessionsStore => ({
    ...buildFakeStore(),
    getSessionPreview:
      overrides.getSessionPreview ??
      (async () => ({
        id: PREVIEW_SESSION_ID,
        type: 'dynamic_qr',
        durationMode: 'fixed',
        plannedDurationMinutes: 30,
        status: 'active',
        startedAt: new Date().toISOString(),
        venueId: null,
      })),
    getOpenParticipantCount: overrides.getOpenParticipantCount ?? (async () => 3),
  });

  it('previews a session reached via a real session token', async () => {
    const token = await mintAuthToken(HOST_ID);
    const qrToken = mintQrToken(PREVIEW_SESSION_ID, QR_SECRET);

    const response = await request(buildApp(buildPreviewStore()))
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: qrToken });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      sessionId: PREVIEW_SESSION_ID,
      type: 'dynamic_qr',
      participantCount: 3,
    });
  });

  it('rejects an invalid token', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildPreviewStore()))
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: 'garbage' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_qr_token');
  });

  it('returns session_not_found when the token verifies but the row is gone', async () => {
    const token = await mintAuthToken(HOST_ID);
    const qrToken = mintQrToken(PREVIEW_SESSION_ID, QR_SECRET);
    const store = buildPreviewStore({ getSessionPreview: async () => null });

    const response = await request(buildApp(store))
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${token}`)
      .send({ token: qrToken });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('session_not_found');
  });

  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildPreviewStore()))
      .post('/sessions/preview')
      .send({ token: 'anything' });

    expect(response.status).toBe(401);
  });
});
