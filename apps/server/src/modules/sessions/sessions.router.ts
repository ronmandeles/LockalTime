import type { RequestHandler } from 'express';
import { Router } from 'express';
import { z } from 'zod';

import { ApiError } from '../../middleware/api-error';
import type { AttestationProvider } from '../attestation/attestation-provider';
import type { AttestationStore } from '../attestation/attestation-store';
import { recordDeviceAttestation } from '../attestation/record-attestation';
import { createSession } from './create-session';
import { endSession } from './end-session';
import { finalizeEmergencyExit } from './finalize-emergency-exit';
import { joinSession } from './join-session';
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
    planned_duration_minutes: z.number().int().positive().optional(),
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

    createSession(deps.store, deps.qrSigningSecret, {
      hostId,
      type: body.type,
      durationMode: body.duration_mode,
      plannedDurationMinutes:
        body.duration_mode === 'fixed' ? body.planned_duration_minutes ?? null : null,
      venueId: body.venue_id ?? null,
    })
      .then(async (session) => {
        // Monitor-mode only — recordDeviceAttestation never throws, so
        // this can never turn a successful create into a failed response.
        if (body.attestation !== undefined) {
          await recordDeviceAttestation(deps.attestationProvider, deps.attestationStore, {
            userId: hostId,
            sessionId: session.id,
            platform: body.attestation.platform,
            action: 'create',
            token: body.attestation.token,
          });
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
            await recordDeviceAttestation(deps.attestationProvider, deps.attestationStore, {
              userId,
              sessionId: result.sessionId,
              platform: attestation.platform,
              action: 'join',
              token: attestation.token,
            });
          }
          res.status(result.outcome === 'joined' ? 201 : 200).json({ sessionId: result.sessionId });
          return;
        }
        const failure = JOIN_FAILURE_RESPONSES[result.outcome];
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
