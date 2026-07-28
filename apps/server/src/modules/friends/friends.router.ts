import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { MIN_FRIEND_SEARCH_QUERY_LENGTH } from '../../config/constants';
import { ApiError } from '../../middleware/api-error';
import type { FriendsStore } from './friends-store';

export interface FriendsRouterDeps {
  readonly store: FriendsStore;
  readonly requireAuth: RequestHandler;
}

const searchQuerySchema = z.object({
  q: z.string().trim().min(MIN_FRIEND_SEARCH_QUERY_LENGTH),
});

const sendRequestBodySchema = z.object({
  recipientId: z.string().min(1),
});

const respondBodySchema = z.object({
  accept: z.boolean(),
});

export const createFriendsRouter = (deps: FriendsRouterDeps): Router => {
  const router = Router();
  const { requireAuth } = deps;

  router.get('/search', requireAuth, (req, res, next) => {
    const parsed = searchQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      next(
        new ApiError(
          400,
          'query_too_short',
          `q must be at least ${MIN_FRIEND_SEARCH_QUERY_LENGTH} characters`,
        ),
      );
      return;
    }
    const callerId = req.auth?.userId as string;

    deps.store
      .searchUsers(callerId, parsed.data.q)
      .then((results) => {
        res.status(200).json({ results });
      })
      .catch(next);
  });

  // The leaderboard: aggregates only (totalPoints, hadSessionToday) —
  // never current_streak or anything else user_stats/user_streaks hold.
  router.get('/', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;

    deps.store
      .listFriends(userId)
      .then((leaderboard) => {
        res.status(200).json({ leaderboard });
      })
      .catch(next);
  });

  router.get('/requests', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;

    deps.store
      .listPendingRequests(userId)
      .then((pending) => {
        res.status(200).json(pending);
      })
      .catch(next);
  });

  // requesterId always comes from the verified token, never the body —
  // same mass-assignment guard as venues.router.ts's owner_id.
  router.post('/requests', requireAuth, (req, res, next) => {
    const parsed = sendRequestBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ApiError(400, 'invalid_request', 'recipientId is required'));
      return;
    }
    const requesterId = req.auth?.userId as string;

    deps.store
      .sendFriendRequest(requesterId, parsed.data.recipientId)
      .then((outcome) => {
        if (outcome === 'invalid_recipient') {
          next(
            new ApiError(400, 'invalid_recipient', 'You cannot send a friend request to yourself'),
          );
          return;
        }
        // requested / already_requested / already_friends / friends are
        // all successful, idempotent-safe outcomes — the body's status
        // field is what tells the client which one happened.
        res.status(200).json({ status: outcome });
      })
      .catch(next);
  });

  // recipientId always comes from the verified token, never the body —
  // a non-recipient must never be able to accept/decline someone else's
  // request even by guessing the request id.
  router.post('/requests/:id/respond', requireAuth, (req, res, next) => {
    const parsed = respondBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ApiError(400, 'invalid_request', 'accept must be a boolean'));
      return;
    }
    const recipientId = req.auth?.userId as string;

    deps.store
      .respondToFriendRequest(recipientId, req.params.id, parsed.data.accept)
      .then((outcome) => {
        if (outcome === 'not_found') {
          next(new ApiError(404, 'request_not_found', 'Friend request not found'));
          return;
        }
        res.status(200).json({ status: outcome });
      })
      .catch(next);
  });

  return router;
};
