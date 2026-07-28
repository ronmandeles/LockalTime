import express from 'express';
import request from 'supertest';

import { createRequireAuth } from '../../middleware/require-auth';
import { errorHandler } from '../../middleware/error-handler';
import { unconfiguredAttestationProvider } from '../attestation/attestation-provider';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { createSessionsRouter } from './sessions.router';
import type { SessionsStore } from './sessions-store';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';
const USER_ID = 'user-abc-123';

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const mintAuthToken = async (sub: string) => jwks.mintToken({ sub });

const buildFakeStore = (
  markBlockerReady: SessionsStore['markBlockerReady'] = async () => {},
): SessionsStore => ({
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
  markBlockerReady,
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
});

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

describe('POST /sessions/:id/blocker-ready', () => {
  it('rejects an unauthenticated request', async () => {
    const response = await request(buildApp(buildFakeStore())).post(
      `/sessions/${SESSION_ID}/blocker-ready`,
    );

    expect(response.status).toBe(401);
  });

  it('returns 200 and calls markBlockerReady with the caller as userId', async () => {
    const token = await mintAuthToken(USER_ID);
    let calledWith: { sessionId: string; userId: string } | null = null;
    const store = buildFakeStore(async (sessionId, userId) => {
      calledWith = { sessionId, userId };
    });

    const response = await request(buildApp(store))
      .post(`/sessions/${SESSION_ID}/blocker-ready`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
    expect(calledWith).toEqual({ sessionId: SESSION_ID, userId: USER_ID });
  });

  it('surfaces a store failure as a 500, never crashing the process', async () => {
    const token = await mintAuthToken(USER_ID);
    const store = buildFakeStore(async () => {
      throw new Error('db unreachable');
    });

    const response = await request(buildApp(store))
      .post(`/sessions/${SESSION_ID}/blocker-ready`)
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(500);
  });
});
