import express from 'express';
import request from 'supertest';

import { ApiError } from './api-error';
import { errorHandler } from './error-handler';

// Every route in the app funnels errors here via next(err), so this is the
// one place that decides the JSON error envelope the mobile app parses
// (docs/plan: { error: { code, message } }).
const buildApp = (): express.Express => {
  const app = express();
  app.get('/known', (_req, _res, next) => {
    next(new ApiError(404, 'session_not_found', 'No session with that id'));
  });
  app.get('/unknown', () => {
    throw new Error('something exploded');
  });
  app.use(errorHandler);
  return app;
};

describe('errorHandler', () => {
  it('renders an ApiError as its own status/code/message', async () => {
    const response = await request(buildApp()).get('/known');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      error: { code: 'session_not_found', message: 'No session with that id' },
    });
  });

  it('renders an unrecognized thrown error as a generic 500 without leaking internals', async () => {
    const response = await request(buildApp()).get('/unknown');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'internal_error', message: 'Something went wrong' },
    });
    // The real message ("something exploded") must never reach the client.
    expect(JSON.stringify(response.body)).not.toContain('something exploded');
  });
});
