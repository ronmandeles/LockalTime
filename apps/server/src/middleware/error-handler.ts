import type { ErrorRequestHandler } from 'express';

import { ApiError } from './api-error';

// The single choke point every route's error funnels through (via
// next(err) or an uncaught throw in an async-wrapped handler). Decides the
// one JSON error envelope shape the mobile app parses: { error: { code,
// message } }. An ApiError renders as its own status/code/message; anything
// else is an unanticipated bug — logged in full server-side (and reported
// to captureException, Phase 7's crash-monitoring seam — see
// services/monitoring.ts), but the client only ever sees a generic message
// so internals never leak.
//
// A factory, not a plain export, so app.ts can inject the real
// Monitoring.captureException (or a test's no-op) — same DI shape as
// createRequireRole(store, allowed).
export const createErrorHandler = (
  captureException: (error: unknown) => void = () => undefined,
): ErrorRequestHandler => {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only
  // recognizes a 4-arg function as error-handling middleware.
  return (err, _req, res, _next): void => {
    if (err instanceof ApiError) {
      res.status(err.status).json({ error: { code: err.code, message: err.message } });
      return;
    }

    // eslint-disable-next-line no-console -- only server-side error log path.
    console.error('Unhandled error', err);
    captureException(err);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
  };
};

// The no-monitoring-injected default — every test file across this
// codebase that builds its own minimal Express app around one router
// (friends.router.test.ts, venues.router.test.ts, etc.) uses this directly;
// only app.ts (the real, full application) needs the injected variant.
export const errorHandler = createErrorHandler();
