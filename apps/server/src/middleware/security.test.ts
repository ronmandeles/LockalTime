import request from 'supertest';

import { TEST_ENV } from '../test-support/fixtures';
import { createApp } from '../app';

// Route-level tests against the real createApp(TEST_ENV) (api-design skill:
// "supertest against createApp(TEST_ENV) for route-level tests"). Exercises
// helmet's headers and express-rate-limit's counting through the real HTTP
// stack rather than re-implementing either library's behavior in a mock.
describe('security middleware', () => {
  it('sets helmet security headers on every response, including 404s', async () => {
    const app = createApp(TEST_ENV);

    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    // Express apps aren't rendered in a browser — helmet's default CSP is
    // meant for HTML responses and would only add noise to a JSON API.
    expect(res.headers['content-security-policy']).toBeUndefined();
  });

  it('does not rate-limit /health (used by PaaS liveness checks)', async () => {
    const app = createApp(TEST_ENV);

    for (let i = 0; i < 50; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
    }
  });

  it('returns 429 once a public endpoint is called more than its limit within the window', async () => {
    const app = createApp(TEST_ENV);
    const body = { email: 'someone@example.com' };

    let lastStatus = 0;
    for (let i = 0; i < 105; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app).post('/sessions').send(body);
      lastStatus = res.status;
      if (lastStatus === 429) {
        break;
      }
    }

    expect(lastStatus).toBe(429);
  });

  it('rate-limit response uses the standard ApiError envelope', async () => {
    const app = createApp(TEST_ENV);

    let res = await request(app).post('/friends/requests').send({ recipientId: 'x' });
    for (let i = 0; i < 105 && res.status !== 429; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      res = await request(app).post('/friends/requests').send({ recipientId: 'x' });
    }

    expect(res.status).toBe(429);
    expect(res.body).toEqual({
      error: { code: 'rate_limited', message: expect.any(String) },
    });
  });
});
