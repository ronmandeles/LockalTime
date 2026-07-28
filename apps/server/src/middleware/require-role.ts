import type { NextFunction, Request, RequestHandler, Response } from 'express';

import type { UserRole, UsersStore } from '../modules/users/users-store';
import { ApiError } from './api-error';

// Mounted AFTER requireAuth on any route that needs one -- req.auth.userId
// must already be set (see require-auth.ts). A per-request DB lookup, not
// a JWT claim: a Supabase custom-access-token hook would avoid the query,
// but would leave the role stale until the caller's token next refreshes --
// wrong for a flag flipped by hand in Supabase Studio
// (docs/RUNBOOK_VERIFIED_HOST.md), and only a handful of Phase 6 routes
// (venues, B2B metrics) pay this query's cost.
export const createRequireRole = (
  store: UsersStore,
  allowed: readonly UserRole[],
): RequestHandler => {
  const allowedSet = new Set<UserRole>(allowed);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const userId = req.auth?.userId;
    if (userId === undefined) {
      // Should be unreachable in practice (requireRole is only ever mounted
      // after requireAuth) -- fails closed rather than assuming, in case a
      // future route wires the order wrong.
      next(new ApiError(401, 'unauthorized', 'requireRole used without requireAuth'));
      return;
    }

    store
      .getUserRole(userId)
      .then((role) => {
        if (!allowedSet.has(role)) {
          next(
            new ApiError(
              403,
              'insufficient_role',
              `This action requires one of: ${allowed.join(', ')}`,
            ),
          );
          return;
        }
        next();
      })
      .catch(next);
  };
};
