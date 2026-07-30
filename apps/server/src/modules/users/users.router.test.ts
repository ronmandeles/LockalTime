import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler';
import { createRequireAuth } from '../../middleware/require-auth';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { createUsersRouter } from './users.router';
import type { UserRole, UsersStore } from './users-store';

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const buildFakeUsersStore = (overrides?: Partial<UsersStore>): UsersStore => ({
  async getUserRole(): Promise<UserRole> {
    return 'user';
  },
  async deleteAccount(): Promise<void> {
    // no-op
  },
  ...overrides,
});

const buildApp = (store: UsersStore): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/account',
    createUsersRouter({
      store,
      requireAuth: createRequireAuth(jwks.getKey),
    }),
  );
  app.use(errorHandler);
  return app;
};

describe('DELETE /account', () => {
  it("deletes the caller's own account, never a userId supplied in the body", async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    let deletedUserId: string | undefined;
    const store = buildFakeUsersStore({
      async deleteAccount(userId: string): Promise<void> {
        deletedUserId = userId;
      },
    });

    const res = await request(buildApp(store))
      .delete('/account')
      .set('Authorization', `Bearer ${token}`)
      // A malicious/careless client-supplied userId in the body must be
      // ignored -- the deleted account is always the token's own subject
      // (same mass-assignment guard as friends.router.ts's requesterId).
      .send({ userId: 'someone-elses-id' });

    expect(res.status).toBe(204);
    expect(deletedUserId).toBe('caller-1');
  });

  it('requires authentication', async () => {
    const res = await request(buildApp(buildFakeUsersStore())).delete('/account');

    expect(res.status).toBe(401);
  });

  it('surfaces a store failure as a 500 through the standard error envelope', async () => {
    const token = await jwks.mintToken({ sub: 'caller-2' });
    const store = buildFakeUsersStore({
      async deleteAccount(): Promise<void> {
        throw new Error('supabase admin API unreachable');
      },
    });

    const res = await request(buildApp(store))
      .delete('/account')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: { code: 'internal_error', message: expect.any(String) },
    });
  });
});
