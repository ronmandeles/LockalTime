import type { NextFunction, Request, Response } from 'express';

import { ApiError } from './api-error';

// The single choke point every route's error funnels through (via
// next(err) or an uncaught throw in an async-wrapped handler). Decides the
// one JSON error envelope shape the mobile app parses: { error: { code,
// message } }. An ApiError renders as its own status/code/message; anything
// else is an unanticipated bug — logged in full server-side, but the client
// only ever sees a generic message so internals never leak.
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- Express only
// recognizes a 4-arg function as error-handling middleware.
export const errorHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  // eslint-disable-next-line no-console -- only server-side error log path.
  console.error('Unhandled error', err);
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong' } });
};
