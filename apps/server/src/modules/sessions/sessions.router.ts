import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import {
  ATTESTATION_ENFORCEMENT_ENABLED,
  FIXED_SESSION_MAX_DURATION_MINUTES,
} from '../../config/constants';
import { ApiError } from '../../middleware/api-error';
import type { AttestationProvider } from '../attestation/attestation-provider';
import type { AttestationStore } from '../attestation/attestation-store';
import { recordDeviceAttestation } from '../attestation/record-attestation';
import { applyEnforcementPolicy, verdictToTrustTier } from '../attestation/trust-tier';
import type { VenuesStore } from '../venues/venues-store';
import { createSession } from './create-session';
import { endSession } from './end-session';
import { finalizeEmergencyExit } from './finalize-emergency-exit';
import { joinSession } from './join-session';
import { joinVenueSession } from './join-venue-session';
import { previewSession } from './preview-session';
import { rejoinSession } from './rejoin-session';
import type { SessionsStore } from './sessions-store';

export interface SessionsRouterDeps {
  readonly store: SessionsStore;
  readonly qrSigningSecret: string;
  // Built once by the caller (createApp wires it from the real Supabase
  // JWKS) — this module doesn't need to know HOW a token is verified,
  // only that requests reach it already authenticated.
  readonly requireAuth: RequestHandler;
  // Monitor-mode device attestation (ARCHITECTURE.md §8 item 8) — wired
  // into create/join below, never blocks either.
  readonly attestationProvider: AttestationProvider;
  readonly attestationStore: AttestationStore;
  // Phase 6 task 1: venue ownership check for POST / below. Venues are a
  // strictly B2B construct — only a venue's owner may ever tag a session
  // with it, regardless of session type (owner decision; see
  // docs/RUNBOOK_VERIFIED_HOST.md and the plan's "venue tagging" note).
  readonly venuesStore: VenuesStore;
}

// Present only once the mobile app's native Play Integrity/App Attest
// wiring lands (Phase 3+) — optional so create/join work today without it.
// Nested (not two loose top-level fields) so "both present or neither" is
// the schema's natural shape, no extra cross-field refine needed.
const attestationSchema = z.object({
  platform: z.enum(['android', 'ios']),
  token: z.string().min(1),
});

// Mirrors the DB CHECK constraints in supabase/migrations (chk_fixed_has_duration,
// chk_dynamic_qr_has_token) at the API boundary, so a bad request is rejected
// with a clear 400 before it ever reaches the database — belt and braces, not
// a replacement for the DB constraint. planned_duration_minutes is only
// meaningful for a fixed-duration session; an open_ended request simply
// never looks at it (silently ignored rather than rejected, since supplying
// it is harmless).
const createSessionBodySchema = z
  .object({
    type: z.enum(['solo', 'dynamic_qr', 'static_qr']),
    duration_mode: z.enum(['fixed', 'open_ended']).default('fixed'),
    // Capped at FIXED_SESSION_MAX_DURATION_MINUTES (24h) — see its own doc
    // comment for why: the iOS native module's DeviceActivitySchedule
    // wiring assumes no session (fixed or open-ended) exceeds 24h.
    planned_duration_minutes: z
      .number()
      .int()
      .positive()
      .max(FIXED_SESSION_MAX_DURATION_MINUTES)
      .optional(),
    venue_id: z.string().uuid().optional(),
    attestation: attestationSchema.optional(),
  })
  .refine((body) => body.duration_mode !== 'fixed' || body.planned_duration_minutes !== undefined, {
    message: 'planned_duration_minutes is required when duration_mode is "fixed"',
    path: ['planned_duration_minutes'],
  });

const joinSessionBodySchema = z.object({
  token: z.string().min(1),
  attestation: attestationSchema.optional(),
});

// Same shape as joinSessionBodySchema — the QR payload format is
// unchanged either way (Phase 6 task 2's plan note); only which token
// kind the client scanned differs, and this is the dedicated venue-token
// route.
const joinVenueSessionBodySchema = z.object({
  token: z.string().min(1),
  attestation: attestationSchema.optional(),
});

const previewSessionBodySchema = z.object({
  token: z.string().min(1),
});

const leaveSessionBodySchema = z.object({
  reason: z.enum(['emergency_exit', 'involuntary_disconnect']),
});

// join_session()'s outcome (sessions-store.ts's JoinOutcome) is the API's
// real contract, mapped 1:1 to a status + machine-readable code the mobile
// app switches on — same pattern as every other ApiError in this module.
const JOIN_FAILURE_RESPONSES: Record<
  Exclude<Awaited<ReturnType<typeof joinSession>>['outcome'], 'joined' | 'already_joined'>,
  { status: number; code: string; message: string }
> = {
  invalid_token: { status: 400, code: 'invalid_qr_token', message: 'QR token is invalid' },
  not_found: { status: 404, code: 'session_not_found', message: 'Session not found' },
  not_joinable: {
    status: 409,
    code: 'session_not_joinable',
    message: 'Session is not accepting new joins',
  },
  expired: { status: 410, code: 'qr_token_expired', message: 'QR token has expired' },
  at_capacity: { status: 409, code: 'session_at_capacity', message: 'Session is at capacity' },
};

// join_venue_session()'s outcome, mapped the same way as JOIN_FAILURE_RESPONSES
// above. no_active_session is the venue-specific case with no dynamic_qr
// equivalent — the venue exists and its code is genuinely valid, there's
// simply nothing running there right now.
const JOIN_VENUE_FAILURE_RESPONSES: Record<
  Exclude<Awaited<ReturnType<typeof joinVenueSession>>['outcome'], 'joined' | 'already_joined'>,
  { status: number; code: string; message: string }
> = {
  invalid_token: { status: 400, code: 'invalid_qr_token', message: 'QR token is invalid' },
  venue_not_found: { status: 404, code: 'venue_not_found', message: 'Venue not found' },
  no_active_session: {
    status: 404,
    code: 'no_active_session_at_venue',
    message: 'No session is currently running at this venue',
  },
  at_capacity: { status: 409, code: 'session_at_capacity', message: 'Session is at capacity' },
};

// previewSession()'s outcome, mapped the same way — this is the vocabulary
// the plan's "late-join details" edge-case screens (task 7) key their
// recovery affordance off (Scan again / Back to Home / Retry), same as the
// existing join failure codes.
const PREVIEW_FAILURE_RESPONSES: Record<
  Exclude<Awaited<ReturnType<typeof previewSession>>['outcome'], 'ok'>,
  { status: number; code: string; message: string }
> = {
  invalid_token: { status: 400, code: 'invalid_qr_token', message: 'QR token is invalid' },
  session_not_found: { status: 404, code: 'session_not_found', message: 'Session not found' },
  venue_not_found: { status: 404, code: 'venue_not_found', message: 'Venue not found' },
  no_active_session: {
    status: 404,
    code: 'no_active_session_at_venue',
    message: 'No session is currently running at this venue',
  },
};

// rejoin_session()'s outcome, mapped the same way. Screen 13 (Welcome Back)
// is the one caller — reached only when the client already believes it was
// previously in this session, so not_a_participant is a genuine trust-boundary
// rejection (403), not a user-facing "you typed the wrong code" scenario the
// way invalid_token is for the token-based join.
const REJOIN_FAILURE_RESPONSES: Record<
  Exclude<Awaited<ReturnType<typeof rejoinSession>>['outcome'], 'joined' | 'already_joined'>,
  { status: number; code: string; message: string }
> = {
  not_found: { status: 404, code: 'session_not_found', message: 'Session not found' },
  not_joinable: {
    status: 409,
    code: 'session_not_joinable',
    message: 'Session is not accepting new joins',
  },
  not_a_participant: {
    status: 403,
    code: 'not_a_prior_participant',
    message: 'You were never a participant in this session',
  },
  at_capacity: { status: 409, code: 'session_at_capacity', message: 'Session is at capacity' },
};

export const createSessionsRouter = (deps: SessionsRouterDeps): Router => {
  const router = Router();
  const { requireAuth } = deps;

  router.post('/', requireAuth, (req, res, next) => {
    const parsed = createSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ');
      next(new ApiError(400, 'invalid_request', details));
      return;
    }
    // req.auth is always set here — requireAuth already rejected the
    // request with 401 if it weren't. hostId comes ONLY from the verified
    // token, never from the body (mass-assignment guard: the body's shape
    // doesn't even have a host_id field to strip).
    const hostId = req.auth?.userId as string;
    const body = parsed.data;

    // Ownership check runs before createSession — a venue_id the caller
    // doesn't own must reject the whole request, not just get silently
    // dropped. Applies to every session type (not just static_qr): venues
    // stay a strictly B2B construct, never a free-form location label a
    // non-owner can attach to their own session.
    const venueCheck: Promise<void> =
      body.venue_id === undefined
        ? Promise.resolve()
        : deps.venuesStore.getVenueById(body.venue_id).then((venue) => {
            if (venue === null) {
              throw new ApiError(404, 'venue_not_found', 'Venue not found');
            }
            if (venue.ownerId !== hostId) {
              throw new ApiError(403, 'venue_not_owned', 'You do not own this venue');
            }
          });

    venueCheck
      .then(() =>
        createSession(deps.store, deps.qrSigningSecret, {
          hostId,
          type: body.type,
          durationMode: body.duration_mode,
          plannedDurationMinutes:
            body.duration_mode === 'fixed' ? body.planned_duration_minutes ?? null : null,
          venueId: body.venue_id ?? null,
        }),
      )
      .then(async (session) => {
        // Monitor-mode only — recordDeviceAttestation never throws, so
        // this can never turn a successful create into a failed response.
        if (body.attestation !== undefined) {
          const verdict = await recordDeviceAttestation(
            deps.attestationProvider,
            deps.attestationStore,
            {
              userId: hostId,
              sessionId: session.id,
              platform: body.attestation.platform,
              action: 'create',
              token: body.attestation.token,
            },
          );
          const tier = applyEnforcementPolicy(
            verdictToTrustTier(verdict),
            ATTESTATION_ENFORCEMENT_ENABLED,
          );
          deps.store.markDeviceTrust(session.id, hostId, tier).catch(() => undefined);
        }
        res.status(201).json(session);
      })
      .catch(next);
  });

  router.post('/join', requireAuth, (req, res, next) => {
    const parsed = joinSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ApiError(400, 'invalid_request', 'token is required'));
      return;
    }
    const userId = req.auth?.userId as string;

    const { attestation } = parsed.data;

    joinSession(deps.store, deps.qrSigningSecret, { token: parsed.data.token, userId })
      .then(async (result) => {
        if (result.outcome === 'joined' || result.outcome === 'already_joined') {
          if (attestation !== undefined) {
            const verdict = await recordDeviceAttestation(
              deps.attestationProvider,
              deps.attestationStore,
              {
                userId,
                sessionId: result.sessionId,
                platform: attestation.platform,
                action: 'join',
                token: attestation.token,
              },
            );
            // Phase 6 tasks 8-9: fire-and-forget, same posture as
            // markBlockerReady — a failure here never blocks the join
            // response the caller is already waiting on.
            const tier = applyEnforcementPolicy(
              verdictToTrustTier(verdict),
              ATTESTATION_ENFORCEMENT_ENABLED,
            );
            deps.store.markDeviceTrust(result.sessionId, userId, tier).catch(() => undefined);
          }
          res.status(result.outcome === 'joined' ? 201 : 200).json({ sessionId: result.sessionId });
          return;
        }
        const failure = JOIN_FAILURE_RESPONSES[result.outcome];
        next(new ApiError(failure.status, failure.code, failure.message));
      })
      .catch(next);
  });

  // Venue-scoped counterpart to /join (Phase 6 task 2) — the printed venue
  // QR encodes a venue token, not a session token, so it needs its own
  // route rather than overloading /join with two incompatible token
  // shapes. Same attestation-recording shape as /join above.
  router.post('/join-venue', requireAuth, (req, res, next) => {
    const parsed = joinVenueSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ApiError(400, 'invalid_request', 'token is required'));
      return;
    }
    const userId = req.auth?.userId as string;

    const { attestation } = parsed.data;

    joinVenueSession(deps.store, deps.qrSigningSecret, { token: parsed.data.token, userId })
      .then(async (result) => {
        if (result.outcome === 'joined' || result.outcome === 'already_joined') {
          if (attestation !== undefined) {
            const verdict = await recordDeviceAttestation(
              deps.attestationProvider,
              deps.attestationStore,
              {
                userId,
                sessionId: result.sessionId,
                platform: attestation.platform,
                action: 'join',
                token: attestation.token,
              },
            );
            const tier = applyEnforcementPolicy(
              verdictToTrustTier(verdict),
              ATTESTATION_ENFORCEMENT_ENABLED,
            );
            deps.store.markDeviceTrust(result.sessionId, userId, tier).catch(() => undefined);
          }
          res.status(result.outcome === 'joined' ? 201 : 200).json({ sessionId: result.sessionId });
          return;
        }
        const failure = JOIN_VENUE_FAILURE_RESPONSES[result.outcome];
        next(new ApiError(failure.status, failure.code, failure.message));
      })
      .catch(next);
  });

  // Phase 6 task 4: real session details before joining, without exposing
  // anything a non-participant's RLS would otherwise deny them (a
  // dedicated Node endpoint, not a direct client read — see
  // preview-session.ts's header). requireAuth only, no further gate: this
  // is not an open enumeration endpoint (a caller still needs a real,
  // correctly-signed token), just not host/participant-only either — a
  // stranger about to join is exactly who needs to see this.
  router.post('/preview', requireAuth, (req, res, next) => {
    const parsed = previewSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(new ApiError(400, 'invalid_request', 'token is required'));
      return;
    }

    previewSession(deps.store, deps.venuesStore, deps.qrSigningSecret, parsed.data.token)
      .then((result) => {
        if (result.outcome === 'ok') {
          res.status(200).json(result.preview);
          return;
        }
        const failure = PREVIEW_FAILURE_RESPONSES[result.outcome];
        next(new ApiError(failure.status, failure.code, failure.message));
      })
      .catch(next);
  });

  // Token-free counterpart to /join — Screen 13's "Welcome Back" flow
  // (ARCHITECTURE.md §2/§4) for a gap longer than the QR token's 15-minute
  // TTL. No body to validate: the session id comes from the URL, the caller
  // from the verified auth token, same trust-boundary shape as /:id/leave.
  router.post('/:id/rejoin', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;
    const sessionId = req.params.id;

    rejoinSession(deps.store, { sessionId, userId })
      .then((result) => {
        if (result.outcome === 'joined' || result.outcome === 'already_joined') {
          res.status(result.outcome === 'joined' ? 201 : 200).json({ sessionId });
          return;
        }
        const failure = REJOIN_FAILURE_RESPONSES[result.outcome];
        next(new ApiError(failure.status, failure.code, failure.message));
      })
      .catch(next);
  });

  router.post('/:id/leave', requireAuth, (req, res, next) => {
    const parsed = leaveSessionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      next(
        new ApiError(
          400,
          'invalid_request',
          'reason must be emergency_exit or involuntary_disconnect',
        ),
      );
      return;
    }
    const userId = req.auth?.userId as string;

    const sessionId = req.params.id;
    deps.store
      .closeOpenInterval(sessionId, userId, parsed.data.reason)
      .then(async (closed) => {
        if (!closed) {
          next(
            new ApiError(
              404,
              'not_joined',
              'No open presence interval for this user in this session',
            ),
          );
          return;
        }
        // Emergency exit finalizes immediately — the participant forfeits
        // both bonuses unconditionally (§7), so there's no reason to wait
        // for session end. involuntary_disconnect never finalizes here:
        // the participant may still reconnect, so their exit_reason isn't
        // known yet (the stale-interval reconciliation worker or
        // end-session.ts settles it later).
        if (parsed.data.reason === 'emergency_exit') {
          await finalizeEmergencyExit(deps.store, sessionId, userId);
        }
        res.status(200).json({ left: true });
      })
      .catch(next);
  });

  // Advisory only (ARCHITECTURE.md §7's Sybil-resistance gate): the client
  // calls this once its native blocker's start() actually resolves. Always
  // 200 — this can never fail the caller's flow the way join/leave do,
  // since it only affects whether the participant later counts toward the
  // Group Bonus threshold, never whether they're in the session at all.
  router.post('/:id/blocker-ready', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;

    deps.store
      .markBlockerReady(req.params.id, userId, new Date().toISOString())
      .then(() => {
        res.status(200).json({ ok: true });
      })
      .catch(next);
  });

  // Host-only. The auto-close sweep (Phase 4's session sweep worker) ends a
  // session the same way but calls endSession() directly with a null
  // endedBy — it never goes through this HTTP route, since there's no
  // authenticated caller to check.
  router.post('/:id/end', requireAuth, (req, res, next) => {
    const userId = req.auth?.userId as string;

    endSession(deps.store, req.params.id, { endedBy: userId, endReason: 'host_ended' })
      .then((result) => {
        if (result.outcome === 'ended') {
          res.status(200).json({ endedAt: result.endedAt });
          return;
        }
        if (result.outcome === 'not_found') {
          next(new ApiError(404, 'session_not_found', 'Session not found'));
          return;
        }
        if (result.outcome === 'not_active') {
          next(new ApiError(409, 'session_not_active', 'Session is not active'));
          return;
        }
        next(new ApiError(403, 'not_session_host', 'Only the session host can end it'));
      })
      .catch(next);
  });

  return router;
};
