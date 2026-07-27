import express from 'express';
import request from 'supertest';

import { createRequireAuth } from '../../middleware/require-auth';
import { errorHandler } from '../../middleware/error-handler';
import { unconfiguredAttestationProvider } from '../attestation/attestation-provider';
import type { AttestationStore, RecordAttestationInput } from '../attestation/attestation-store';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { verifyQrToken } from './qr-token';
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
    // Not exercised by these tests — present only to satisfy the
    // SessionsStore interface.
    async joinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeOpenInterval(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

const buildApp = (
  store: SessionsStore,
  attestationStore: AttestationStore = buildFakeAttestationStore(),
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
