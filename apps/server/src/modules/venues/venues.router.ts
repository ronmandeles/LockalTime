import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { ApiError } from '../../middleware/api-error';
import type { SessionsStore } from '../sessions/sessions-store';
import { createVenue } from './create-venue';
import { getVenueMetrics } from './get-venue-metrics';
import { mintVenueQrToken } from './venue-qr-token';
import type { VenuesStore } from './venues-store';

export interface VenuesRouterDeps {
  readonly store: VenuesStore;
  // Phase 6 task 5: GET /:id/metrics needs session/participant data —
  // cross-module, same direction as sessions.router.ts already depending
  // on VenuesStore for its own ownership check.
  readonly sessionsStore: SessionsStore;
  readonly qrSigningSecret: string;
  readonly requireAuth: RequestHandler;
  // Built by the caller as createRequireRole(usersStore, ['verified_host',
  // 'admin']) — venues are a strictly B2B construct (ARCHITECTURE.md §10),
  // never a self-serve feature for a plain user.
  readonly requireVerifiedHost: RequestHandler;
}

const createVenueBodySchema = z.object({
  name: z.string().trim().min(1).max(200),
  address_label: z.string().trim().min(1).max(300).optional(),
});

// getVenueMetrics()'s outcome, mapped the same way as sessions.router.ts's
// JOIN_FAILURE_RESPONSES/PREVIEW_FAILURE_RESPONSES.
const METRICS_FAILURE_RESPONSES: Record<
  Exclude<Awaited<ReturnType<typeof getVenueMetrics>>['outcome'], 'ok'>,
  { status: number; code: string; message: string }
> = {
  venue_not_found: { status: 404, code: 'venue_not_found', message: 'Venue not found' },
  venue_not_owned: { status: 403, code: 'venue_not_owned', message: 'You do not own this venue' },
};

export const createVenuesRouter = (deps: VenuesRouterDeps): Router => {
  const router = Router();
  const { requireAuth, requireVerifiedHost } = deps;

  router.post('/', requireAuth, requireVerifiedHost, (req, res, next) => {
    const parsed = createVenueBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      next(new ApiError(400, 'invalid_request', details));
      return;
    }
    // owner_id comes only from the verified token, never the body — same
    // mass-assignment guard as sessions.router.ts's host_id.
    const ownerId = req.auth?.userId as string;

    createVenue(deps.store, deps.qrSigningSecret, {
      ownerId,
      name: parsed.data.name,
      addressLabel: parsed.data.address_label ?? null,
    })
      .then((venue) => {
        res.status(201).json(venue);
      })
      .catch(next);
  });

  // Only the caller's own venues -- never another host's, even though the
  // caller is themselves a verified_host. Ownership, not role, is the read
  // scope.
  router.get('/', requireAuth, requireVerifiedHost, (req, res, next) => {
    const ownerId = req.auth?.userId as string;

    deps.store
      .listVenuesForOwner(ownerId)
      .then((venues) => {
        res.status(200).json({ venues });
      })
      .catch(next);
  });

  // Invalidates the venue's printed code and mints a fresh one — always a
  // deliberate, confirmed action (the mobile venue screen asks "are you
  // sure?" before calling this), never automatic. Scoped to (id, ownerId)
  // at the store layer, so a guessed venue id belonging to someone else
  // 404s rather than leaking whether it exists.
  router.post('/:id/qr/regenerate', requireAuth, requireVerifiedHost, (req, res, next) => {
    const ownerId = req.auth?.userId as string;
    const qrToken = mintVenueQrToken(req.params.id, deps.qrSigningSecret);

    deps.store
      .regenerateQrToken(req.params.id, ownerId, qrToken)
      .then((venue) => {
        if (venue === null) {
          next(new ApiError(404, 'venue_not_found', 'Venue not found'));
          return;
        }
        res.status(200).json(venue);
      })
      .catch(next);
  });

  // B2B dashboard's data source (ARCHITECTURE.md §10, Phase 6 task 5) —
  // aggregates only, never individual customers. Ownership is checked
  // inside getVenueMetrics() itself, not just requireVerifiedHost here:
  // role alone would let any verified host read ANY venue's numbers.
  router.get('/:id/metrics', requireAuth, requireVerifiedHost, (req, res, next) => {
    const callerId = req.auth?.userId as string;

    getVenueMetrics(deps.store, deps.sessionsStore, req.params.id, callerId)
      .then((result) => {
        if (result.outcome === 'ok') {
          res.status(200).json(result.metrics);
          return;
        }
        const failure = METRICS_FAILURE_RESPONSES[result.outcome];
        next(new ApiError(failure.status, failure.code, failure.message));
      })
      .catch(next);
  });

  return router;
};
