import type { RequestHandler } from 'express';
import { Router } from 'express';

import type { UsersStore } from './users-store';

export interface UsersRouterDeps {
  readonly store: UsersStore;
  readonly requireAuth: RequestHandler;
}

// Mounted at /account (app.ts). One route today -- account deletion -- kept
// separate from users-store's existing role-lookup consumer (require-role.ts)
// since this is the first user-facing, user-triggered endpoint over
// public.users/auth.users rather than internal middleware plumbing.
export const createUsersRouter = (deps: UsersRouterDeps): Router => {
  const router = Router();
  const { requireAuth, store } = deps;

  // Deletes the CALLER's own account only -- userId always comes from the
  // verified token, never accepted from the body/params, so no caller can
  // ever delete another user's account even by guessing their id (same
  // mass-assignment guard as friends.router.ts's requesterId/recipientId).
  // Deleting the auth.users row cascades through every dependent table via
  // the schema's existing `on delete cascade` chain (DATABASE.md) -- no
  // per-table cleanup code needed here.
  router.delete('/', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;

    store
      .deleteAccount(userId)
      .then(() => {
        res.status(204).end();
      })
      .catch(next);
  });

  return router;
};
