import { SESSION_MAX_PARTICIPANTS } from '../../config/constants';
import type { RejoinOutcome, SessionsStore } from './sessions-store';

export interface RejoinSessionInput {
  readonly sessionId: string;
  readonly userId: string;
}

export interface RejoinSessionResult {
  readonly outcome: RejoinOutcome;
}

// No token to verify here (that's the whole point — see rejoin_session()'s
// migration header): every branch that matters (prior participation,
// capacity, idempotency) is checked atomically inside store.rejoinSession(),
// same as joinSession() delegates its own checks to join_session().
export const rejoinSession = async (
  store: SessionsStore,
  input: RejoinSessionInput,
): Promise<RejoinSessionResult> => {
  const outcome = await store.rejoinSession(
    input.sessionId,
    input.userId,
    SESSION_MAX_PARTICIPANTS,
  );
  return { outcome };
};
