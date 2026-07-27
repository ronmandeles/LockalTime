import { SESSION_MAX_PARTICIPANTS } from '../../config/constants';
import { verifyQrToken } from './qr-token';
import type { SessionsStore } from './sessions-store';

export interface JoinSessionInput {
  readonly token: string;
  readonly userId: string;
}

export type JoinSessionResult =
  | { readonly outcome: 'joined' | 'already_joined'; readonly sessionId: string }
  | {
      readonly outcome: 'invalid_token' | 'not_found' | 'not_joinable' | 'expired' | 'at_capacity';
    };

// Validation order matters (docs/plan task 2.3): signature first — it's the
// cheapest check and, for a garbage/tampered token, reveals nothing about
// which sessions exist (no DB round trip at all). Everything else
// (existence, status, current-token match, expiry, capacity, idempotent
// rejoin) happens atomically inside store.joinSession() — see
// join_session()'s migration for why those can't be separate round trips.
export const joinSession = async (
  store: SessionsStore,
  qrSigningSecret: string,
  input: JoinSessionInput,
): Promise<JoinSessionResult> => {
  const payload = verifyQrToken(input.token, qrSigningSecret);
  if (payload === null) {
    return { outcome: 'invalid_token' };
  }

  const outcome = await store.joinSession(
    payload.sessionId,
    input.userId,
    input.token,
    SESSION_MAX_PARTICIPANTS,
  );

  if (outcome === 'joined' || outcome === 'already_joined') {
    return { outcome, sessionId: payload.sessionId };
  }
  return { outcome };
};
