import helmet from 'helmet';
import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';

import { RATE_LIMIT_MAX_REQUESTS, RATE_LIMIT_WINDOW_MINUTES } from '../config/constants';

// This API has no HTML views to protect with a Content-Security-Policy —
// every response is JSON, consumed by the mobile app, never rendered in a
// browser. Leaving helmet's default CSP on would add a header no client
// reads and nothing else; every other helmet default (nosniff,
// dns-prefetch-control, hidden Referrer-Policy, etc.) still applies.
export const securityHeaders: RequestHandler = helmet({ contentSecurityPolicy: false });

// One global per-IP limiter (api-design skill: mounted after /health so
// PaaS liveness probes are never throttled). Belt-and-suspenders, not
// per-route tuning — every route behind requireAuth already needs a valid
// Supabase session, so this exists to blunt a single scripted client
// hammering the highest-abuse surface (session join/create, friend search)
// rather than to model per-endpoint abuse budgets.
export const rateLimiter: RequestHandler = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
  limit: RATE_LIMIT_MAX_REQUESTS,
  standardHeaders: true,
  legacyHeaders: false,
  // Matches this API's one error envelope (api-design skill) instead of
  // express-rate-limit's default plain-text body.
  handler: (_req, res) => {
    res.status(429).json({
      error: {
        code: 'rate_limited',
        message: 'Too many requests — please try again later.',
      },
    });
  },
});
