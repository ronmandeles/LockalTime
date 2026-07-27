import express from 'express';
import request from 'supertest';

import { createRequireAuth } from '../../middleware/require-auth';
import { errorHandler } from '../../middleware/error-handler';
import { unconfiguredAttestationProvider } from '../attestation/attestation-provider';
import type { AttestationStore, RecordAttestationInput } from '../attestation/attestation-store';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { mintQrToken } from './qr-token';
import { createSessionsRouter } from './sessions.router';
import type {
  DisconnectReason,
  HostAssignmentReason,
  JoinOutcome,
  NewSessionInput,
  SessionsStore,
} from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const USER_ID = 'user-abc-123';

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

const buildFakeStore = (options: {
  joinOutcome?: JoinOutcome;
  closeResult?: boolean;
}): SessionsStore & {
  closeCalledWith: { sessionId: string; userId: string; reason: DisconnectReason } | null;
} => {
  const store = {
    closeCalledWith: null as { sessionId: string; userId: string; reason: DisconnectReason } | null,
    async insertSession(_input: NewSessionInput) {
      throw new Error('not used in this test');
    },
    async insertHostAssignment(_s: string, _u: string, _r: HostAssignmentReason) {},
    async joinSession() {
      return options.joinOutcome ?? 'joined';
    },
    async closeOpenInterval(sessionId: string, userId: string, reason: DisconnectReason) {
      store.closeCalledWith = { sessionId, userId, reason };
      return options.closeResult ?? true;
    },
    async insertPresenceInterval(_s: string, _u: string, _j: string) {},
    async getSessionSummary(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeAllOpenIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getPresenceIntervals(): Promise<never> {
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

describe('POST /sessions/join', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildFakeStore({})))
      .post('/sessions/join')
      .send({ token: 'anything' });

    expect(response.status).toBe(401);
  });

  it('rejects a missing token with a 400', async () => {
    const token = await mintAuthToken(USER_ID);

    const response = await request(buildApp(buildFakeStore({})))
      .post('/sessions/join')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });

  it('returns 201 with the session id on a fresh join', async () => {
    const authToken = await mintAuthToken(USER_ID);
    const qrToken = mintQrToken(SESSION_ID, QR_SECRET);

    const response = await request(buildApp(buildFakeStore({ joinOutcome: 'joined' })))
      .post('/sessions/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: qrToken });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ sessionId: SESSION_ID });
  });

  it('returns 200 (not an error) on an idempotent rejoin', async () => {
    const authToken = await mintAuthToken(USER_ID);
    const qrToken = mintQrToken(SESSION_ID, QR_SECRET);

    const response = await request(buildApp(buildFakeStore({ joinOutcome: 'already_joined' })))
      .post('/sessions/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: qrToken });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ sessionId: SESSION_ID });
  });

  it.each`
    outcome           | status | code
    ${'not_found'}    | ${404} | ${'session_not_found'}
    ${'not_joinable'} | ${409} | ${'session_not_joinable'}
    ${'expired'}      | ${410} | ${'qr_token_expired'}
    ${'at_capacity'}  | ${409} | ${'session_at_capacity'}
  `('maps store outcome $outcome to HTTP $status / $code', async ({ outcome, status, code }) => {
    const authToken = await mintAuthToken(USER_ID);
    const qrToken = mintQrToken(SESSION_ID, QR_SECRET);

    const response = await request(buildApp(buildFakeStore({ joinOutcome: outcome })))
      .post('/sessions/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: qrToken });

    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
  });

  it('records a device attestation on a successful join when the request includes one', async () => {
    const authToken = await mintAuthToken(USER_ID);
    const qrToken = mintQrToken(SESSION_ID, QR_SECRET);
    const attestationStore = buildFakeAttestationStore();

    const response = await request(
      buildApp(buildFakeStore({ joinOutcome: 'joined' }), attestationStore),
    )
      .post('/sessions/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        token: qrToken,
        attestation: { platform: 'ios', token: 'device-attestation-token' },
      });

    expect(response.status).toBe(201);
    expect(attestationStore.recorded).toEqual([
      {
        userId: USER_ID,
        sessionId: SESSION_ID,
        platform: 'ios',
        action: 'join',
        verdict: 'not_configured',
        rawResponse: { platform: 'ios', reason: 'no attestation credentials configured' },
      },
    ]);
  });

  it('maps an invalid/tampered token to a 400 without touching the store', async () => {
    const authToken = await mintAuthToken(USER_ID);

    const response = await request(buildApp(buildFakeStore({})))
      .post('/sessions/join')
      .set('Authorization', `Bearer ${authToken}`)
      .send({ token: 'not-a-real-token' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_qr_token');
  });
});

describe('POST /sessions/:id/leave', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildFakeStore({})))
      .post(`/sessions/${SESSION_ID}/leave`)
      .send({ reason: 'emergency_exit' });

    expect(response.status).toBe(401);
  });

  it('rejects an invalid reason', async () => {
    const authToken = await mintAuthToken(USER_ID);

    const response = await request(buildApp(buildFakeStore({})))
      .post(`/sessions/${SESSION_ID}/leave`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'not-a-real-reason' });

    expect(response.status).toBe(400);
  });

  it('closes the open interval and returns 200', async () => {
    const authToken = await mintAuthToken(USER_ID);
    const store = buildFakeStore({ closeResult: true });

    const response = await request(buildApp(store))
      .post(`/sessions/${SESSION_ID}/leave`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'emergency_exit' });

    expect(response.status).toBe(200);
    expect(store.closeCalledWith).toEqual({
      sessionId: SESSION_ID,
      userId: USER_ID,
      reason: 'emergency_exit',
    });
  });

  it('returns 404 when there is no open interval to close', async () => {
    const authToken = await mintAuthToken(USER_ID);

    const response = await request(buildApp(buildFakeStore({ closeResult: false })))
      .post(`/sessions/${SESSION_ID}/leave`)
      .set('Authorization', `Bearer ${authToken}`)
      .send({ reason: 'involuntary_disconnect' });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_joined');
  });
});
