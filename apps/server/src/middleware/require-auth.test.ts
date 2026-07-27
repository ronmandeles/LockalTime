import express from 'express';
import request from 'supertest';

import { createTestJwks } from '../test-support/local-jwks';
import { errorHandler } from './error-handler';
import { createRequireAuth } from './require-auth';

const buildApp = (jwks: Awaited<ReturnType<typeof createTestJwks>>): express.Express => {
  const app = express();
  app.get('/protected', createRequireAuth(jwks.getKey), (req, res) => {
    res.status(200).json({ userId: req.auth?.userId });
  });
  app.use(errorHandler);
  return app;
};

describe('requireAuth', () => {
  it('rejects a request with no Authorization header', async () => {
    const jwks = await createTestJwks();

    const response = await request(buildApp(jwks)).get('/protected');

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('rejects a malformed Authorization header', async () => {
    const jwks = await createTestJwks();

    const response = await request(buildApp(jwks))
      .get('/protected')
      .set('Authorization', 'not-a-bearer-token');

    expect(response.status).toBe(401);
  });

  it('rejects a token signed with a different key', async () => {
    const jwks = await createTestJwks();
    const otherJwks = await createTestJwks();
    const token = await otherJwks.mintToken();

    const response = await request(buildApp(jwks))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('rejects an expired token', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ exp: Math.floor(Date.now() / 1000) - 60 });

    const response = await request(buildApp(jwks))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(401);
  });

  it('accepts a valid token and exposes the subject as req.auth.userId', async () => {
    const jwks = await createTestJwks();
    const token = await jwks.mintToken({ sub: 'user-abc-123' });

    const response = await request(buildApp(jwks))
      .get('/protected')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ userId: 'user-abc-123' });
  });
});
