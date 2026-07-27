import express from 'express';
import request from 'supertest';

import { createRequireAuth } from '../../middleware/require-auth';
import { errorHandler } from '../../middleware/error-handler';
import { unconfiguredAttestationProvider } from '../attestation/attestation-provider';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { createSessionsRouter } from './sessions.router';
import type {
  EndReason,
  FinalizedParticipantInput,
  PresenceIntervalRow,
  RewardsHistoryRowInput,
  SessionsStore,
  SessionSummary,
} from './sessions-store';

const HOST_ID = 'host-abc-123';
const OTHER_ID = 'other-xyz-789';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const mintAuthToken = async (sub: string) => jwks.mintToken({ sub });

const buildFakeStore = (
  session: SessionSummary | null,
): SessionsStore & {
  markedEnded: { sessionId: string; endedBy: string | null; endReason: EndReason } | null;
} => {
  const store = {
    markedEnded: null as { sessionId: string; endedBy: string | null; endReason: EndReason } | null,
    async insertSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertHostAssignment() {},
    async joinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeOpenInterval(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertPresenceInterval() {},
    async getSessionSummary() {
      return session;
    },
    async closeAllOpenIntervals() {},
    async getPresenceIntervals(): Promise<readonly PresenceIntervalRow[]> {
      return session === null
        ? []
        : [
            {
              userId: session.hostId,
              joinedAt: session.startedAt ?? new Date().toISOString(),
              leftAt: new Date().toISOString(),
              blockerReadyAt: session.startedAt,
              disconnectReason: 'session_ended',
            },
          ];
    },
    async getFinalizedParticipantUserIds() {
      return new Set<string>();
    },
    async writeSessionParticipants(
      _sessionId: string,
      _rows: readonly FinalizedParticipantInput[],
    ) {},
    async insertRewardsHistory(_rows: readonly RewardsHistoryRowInput[]) {},
    async markSessionEnded(input: {
      sessionId: string;
      endedAt: string;
      endedBy: string | null;
      endReason: EndReason;
    }) {
      store.markedEnded = {
        sessionId: input.sessionId,
        endedBy: input.endedBy,
        endReason: input.endReason,
      };
    },
  };
  return store;
};

const buildApp = (store: SessionsStore): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/sessions',
    createSessionsRouter({
      store,
      qrSigningSecret: 'qr-signing-secret-at-least-32-characters-long',
      requireAuth: createRequireAuth(jwks.getKey),
      attestationProvider: unconfiguredAttestationProvider,
      attestationStore: { async recordAttestation() {} },
    }),
  );
  app.use(errorHandler);
  return app;
};

const activeSession: SessionSummary = {
  id: SESSION_ID,
  hostId: HOST_ID,
  status: 'active',
  startedAt: '2026-01-01T10:00:00.000Z',
};

describe('POST /sessions/:id/end', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildFakeStore(activeSession))).post(
      `/sessions/${SESSION_ID}/end`,
    );

    expect(response.status).toBe(401);
  });

  it('returns 200 and ends the session when the caller is the host', async () => {
    const token = await mintAuthToken(HOST_ID);
    const store = buildFakeStore(activeSession);

    const response = await request(buildApp(store))
      .post(`/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.endedAt).toEqual(expect.any(String));
    expect(store.markedEnded).toMatchObject({
      sessionId: SESSION_ID,
      endedBy: HOST_ID,
      endReason: 'host_ended',
    });
  });

  it('returns 403 when the caller is not the host', async () => {
    const token = await mintAuthToken(OTHER_ID);

    const response = await request(buildApp(buildFakeStore(activeSession)))
      .post(`/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('not_session_host');
  });

  it('returns 404 when the session does not exist', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(buildApp(buildFakeStore(null)))
      .post(`/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('session_not_found');
  });

  it('returns 409 when the session is not active (already ended)', async () => {
    const token = await mintAuthToken(HOST_ID);

    const response = await request(
      buildApp(buildFakeStore({ ...activeSession, status: 'completed' })),
    )
      .post(`/sessions/${SESSION_ID}/end`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('session_not_active');
  });
});
