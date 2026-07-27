import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { JWTVerifyGetKey } from 'jose';
import { jwtVerify } from 'jose';

import { ApiError } from './api-error';

// Augments Express's Request type so every downstream handler can read
// req.auth without an assertion — set only by this middleware, once the
// token has been verified.
declare global {
  // Extending Express's own Request type requires this exact `namespace`
  // syntax — no ES2015-module alternative exists for augmenting it.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string };
    }
  }
}

const BEARER_PREFIX = 'Bearer ';

// Verifies the Supabase access token's signature locally rather than
// calling Supabase Auth on every request — no network round-trip on the
// request's hot path, and the API stays up even if Supabase Auth is
// momentarily slow. `getKey` supplies the verification key: in production
// this is Supabase's JWKS (see services/supabase-jwks.ts) — the public
// key is fetched once and cached, so "locally" still holds after the
// first request. Injected rather than constructed here so tests can swap
// in an offline local JWKS instead of hitting the network.
//
// Trade-off: a token stays valid until it expires, even if the user has
// since signed out elsewhere (accepted for Phase 2 — nothing here is
// money-equivalent by itself; each write handler still enforces its own
// authorization).
export const createRequireAuth = (getKey: JWTVerifyGetKey): RequestHandler => {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.headers.authorization;
    if (header === undefined || !header.startsWith(BEARER_PREFIX)) {
      next(new ApiError(401, 'unauthorized', 'Missing or malformed Authorization header'));
      return;
    }
    const token = header.slice(BEARER_PREFIX.length);

    jwtVerify(token, getKey)
      .then(({ payload }) => {
        if (typeof payload.sub !== 'string') {
          next(new ApiError(401, 'unauthorized', 'Token has no subject claim'));
          return;
        }
        req.auth = { userId: payload.sub };
        next();
      })
      .catch(() => {
        next(new ApiError(401, 'unauthorized', 'Invalid or expired token'));
      });
  };
};
