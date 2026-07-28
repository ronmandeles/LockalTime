import { VENUE_SESSION_MAX_PARTICIPANTS } from '../../config/constants';
import { verifyVenueQrToken } from '../venues/venue-qr-token';
import type { SessionsStore } from './sessions-store';

export interface JoinVenueSessionInput {
  readonly token: string;
  readonly userId: string;
}

export type JoinVenueSessionResult =
  | { readonly outcome: 'joined' | 'already_joined'; readonly sessionId: string }
  | {
      readonly outcome: 'invalid_token' | 'venue_not_found' | 'no_active_session' | 'at_capacity';
    };

// Venue-scoped counterpart to join-session.ts's joinSession() — same
// validation order and reasoning: verify the HMAC signature in Node first
// (cheap, reveals nothing about which venues exist for a garbage token),
// then let join_venue_session() resolve "the venue's active session" and
// join it atomically. The raw token string is passed through to the DB
// function too (not just the decoded venueId) — it re-checks the token
// against the venue's CURRENT qr_token column, the same "checked twice"
// shape as join_session(), which is what makes QR regeneration actually
// invalidate the old printed code. Always uses
// VENUE_SESSION_MAX_PARTICIPANTS, never SESSION_MAX_PARTICIPANTS — a
// verified host's static_qr session expects materially more concurrent
// people than a friend-group session (owner decision, Phase 6 task 2).
export const joinVenueSession = async (
  store: SessionsStore,
  qrSigningSecret: string,
  input: JoinVenueSessionInput,
): Promise<JoinVenueSessionResult> => {
  const payload = verifyVenueQrToken(input.token, qrSigningSecret);
  if (payload === null) {
    return { outcome: 'invalid_token' };
  }

  const result = await store.joinVenueSession(
    payload.venueId,
    input.token,
    input.userId,
    VENUE_SESSION_MAX_PARTICIPANTS,
  );

  if (result.outcome === 'joined' || result.outcome === 'already_joined') {
    // sessionId is guaranteed non-null on these two outcomes by
    // join_venue_session() — a session had to be resolved to reach them.
    return { outcome: result.outcome, sessionId: result.sessionId as string };
  }
  return { outcome: result.outcome };
};
