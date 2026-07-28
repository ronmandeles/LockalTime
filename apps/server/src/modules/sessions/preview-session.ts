import { COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS } from '../../config/constants';
import { verifyVenueQrToken } from '../venues/venue-qr-token';
import type { VenuesStore } from '../venues/venues-store';
import { verifyQrToken } from './qr-token';
import type { DurationMode, SessionsStore, SessionStatus, SessionType } from './sessions-store';

export type PreviewTokenKind = 'session' | 'venue';

export interface SessionPreview {
  readonly sessionId: string;
  // Phase 6 task 7: tells the client which join endpoint to call next
  // (POST /sessions/join vs. /sessions/join-venue) — the two token
  // formats resolve to the same preview shape here, but joining still
  // needs the right endpoint, since that's where each token is actually
  // re-verified against its own signing scheme.
  readonly tokenKind: PreviewTokenKind;
  readonly type: SessionType;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly status: SessionStatus;
  readonly startedAt: string | null;
  readonly elapsedMinutes: number | null;
  readonly participantCount: number;
  readonly venueName: string | null;
  // Whether joining RIGHT NOW would still land within
  // COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS of started_at — a statement
  // about whether a reward is still attainable, so it is computed here,
  // server-side, never mirrored into the client (Money-Equivalent Logic
  // Rule, CLAUDE.md). false for a session that hasn't started yet
  // (nothing to be "within tolerance of").
  readonly completionBonusAvailable: boolean;
}

export type PreviewSessionResult =
  | { readonly outcome: 'ok'; readonly preview: SessionPreview }
  | {
      readonly outcome:
        | 'invalid_token'
        | 'session_not_found'
        | 'venue_not_found'
        | 'no_active_session';
    };

// Tries the session-token HMAC first, then the venue-token HMAC — the QR
// payload format stays exactly what create-session.ts/create-venue.ts
// already mint, and the client never needs to know which kind it scanned
// (Phase 6 task 4's plan note). Read-only throughout: never joins,
// never mutates anything, so it carries no capacity/token race to guard
// against the way join-session.ts/join-venue-session.ts do.
export const previewSession = async (
  sessionsStore: SessionsStore,
  venuesStore: VenuesStore,
  qrSigningSecret: string,
  token: string,
  now: () => Date = () => new Date(),
): Promise<PreviewSessionResult> => {
  const sessionPayload = verifyQrToken(token, qrSigningSecret);
  let sessionId: string;
  let tokenKind: PreviewTokenKind;

  if (sessionPayload !== null) {
    sessionId = sessionPayload.sessionId;
    tokenKind = 'session';
  } else {
    const venuePayload = verifyVenueQrToken(token, qrSigningSecret);
    if (venuePayload === null) {
      return { outcome: 'invalid_token' };
    }

    const venue = await venuesStore.getVenueById(venuePayload.venueId);
    if (venue === null) {
      return { outcome: 'venue_not_found' };
    }

    const activeSessionId = await sessionsStore.getActiveStaticQrSessionId(venuePayload.venueId);
    if (activeSessionId === null) {
      return { outcome: 'no_active_session' };
    }
    sessionId = activeSessionId;
    tokenKind = 'venue';
  }

  const row = await sessionsStore.getSessionPreview(sessionId);
  if (row === null) {
    return { outcome: 'session_not_found' };
  }

  const participantCount = await sessionsStore.getOpenParticipantCount(sessionId);

  let venueName: string | null = null;
  if (row.venueId !== null) {
    const venue = await venuesStore.getVenueById(row.venueId);
    venueName = venue?.name ?? null;
  }

  const startedAtMs = row.startedAt !== null ? new Date(row.startedAt).getTime() : null;
  const nowMs = now().getTime();
  const elapsedMinutes =
    startedAtMs === null ? null : Math.max(0, Math.floor((nowMs - startedAtMs) / 60_000));
  const completionBonusAvailable =
    startedAtMs !== null && (nowMs - startedAtMs) / 1000 <= COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS;

  return {
    outcome: 'ok',
    preview: {
      sessionId,
      tokenKind,
      type: row.type,
      durationMode: row.durationMode,
      plannedDurationMinutes: row.plannedDurationMinutes,
      status: row.status,
      startedAt: row.startedAt,
      elapsedMinutes,
      participantCount,
      venueName,
      completionBonusAvailable,
    },
  };
};
