import express from 'express';
import request from 'supertest';

import { createLegalRouter } from './legal.router';

const buildApp = (): express.Express => {
  const app = express();
  app.use('/legal', createLegalRouter());
  return app;
};

describe('GET /legal/terms', () => {
  it('serves the Terms of Service as plain text, no auth required', async () => {
    const res = await request(buildApp()).get('/legal/terms');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('Terms of Service');
  });
});

describe('GET /legal/privacy', () => {
  it('serves the Privacy Policy as plain text, no auth required', async () => {
    const res = await request(buildApp()).get('/legal/privacy');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.text).toContain('Privacy Policy');
  });
});
