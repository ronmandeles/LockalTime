import request from 'supertest';

import { createApp } from '../app';
import { TEST_ENV } from '../test-support/fixtures';

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = createApp(TEST_ENV);

    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'ok' });
  });
});
