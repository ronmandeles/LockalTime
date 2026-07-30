import express from 'express';
import request from 'supertest';

import type { UserRole, UsersStore } from '../modules/users/users-store';
import { createTestJwks } from '../test-support/local-jwks';
import { ApiError } from './api-error';
import { errorHandler } from './error-handler';
import { createRequireAuth } from './require-auth';
import { createRequireRole } from './require-role';

const buildFakeUsersStore = (roles: Record<string, UserRole>): UsersStore => ({
  async getUserRole(userId) {
    const role = roles[userId];
    if (role === undefined) {
      throw new ApiError(404, 'user_not_found', 'No users row for this id');
    }
    return role;
  },
  async deleteAccount(): Promise<void> {
    // not exercised by these tests
  },
});

const buildApp = (
  jwks: Awaited<ReturnType<typeof createTestJwks>>,
  store: UsersStore,
  allowed: readonly UserRole[],
): express.Express => {
  const app = express();
  app.get(
    '/protected',
    createRequireAuth(jwks.getKey),
    createRequireRole(store, allowed),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );
  app.use(errorHandler);
  return app;
};

describe('requireRole', () => {
  it('allows a user whose role is in the allowed set', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ sub: 'host-1' });
    const store = buildFakeUsersStore({ 'host-1': 'verified_host' });

    const response = await request(buildApp(jwks, store, ['verified_host', 'admin']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('allows an admin even when only verified_host is named', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ sub: 'admin-1' });
    const store = buildFakeUsersStore({ 'admin-1': 'admin' });

    const response = await request(buildApp(jwks, store, ['verified_host', 'admin']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
  });

  it('rejects a user whose role is not in the allowed set', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ sub: 'plain-user' });
    const store = buildFakeUsersStore({ 'plain-user': 'user' });

    const response = await request(buildApp(jwks, store, ['verified_host', 'admin']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('insufficient_role');
  });

  it('rejects with no auth header before ever consulting the role store', async () => {
    const jwks = await createTestJwks();
    const store = buildFakeUsersStore({});

    const response = await request(buildApp(jwks, store, ['verified_host'])).get('/protected');

    expect(response.status).toBe(401);
  });

  it('propagates a role-lookup failure as its own error rather than silently allowing through', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ sub: 'ghost-user' });
    const store = buildFakeUsersStore({});

    const response = await request(buildApp(jwks, store, ['verified_host']))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('user_not_found');
  });
});
