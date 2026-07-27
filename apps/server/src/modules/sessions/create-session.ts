import { randomUUID } from 'crypto';

import { QR_TOKEN_TTL_MINUTES } from '../../config/constants';
import { mintQrToken } from './qr-token';
import type { DurationMode, SessionRecord, SessionsStore, SessionType } from './sessions-store';

export interface CreateSessionInput {
  readonly hostId: string;
  readonly type: SessionType;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly venueId: string | null;
}

// Money-equivalent logic (ARCHITECTURE.md §3/§7, .claude/skills/code-style/SKILL.md):
// mints the session id and its QR token — the only place either is decided.
// hostId is trusted as already-sanitized: the router derives it from the
// verified JWT (req.auth.userId), never from the request body, so a
// caller can't create a session "hosted by" someone else.
export const createSession = async (
  store: SessionsStore,
  qrSigningSecret: string,
  input: CreateSessionInput,
): Promise<SessionRecord> => {
  const id = randomUUID();
  const needsQrToken = input.type !== 'solo';
  const qrToken = needsQrToken ? mintQrToken(id, qrSigningSecret) : null;
  const qrExpiresAt = needsQrToken
    ? new Date(Date.now() + QR_TOKEN_TTL_MINUTES * 60_000).toISOString()
    : null;

  const session = await store.insertSession({
    id,
    hostId: input.hostId,
    venueId: input.venueId,
    type: input.type,
    durationMode: input.durationMode,
    plannedDurationMinutes: input.plannedDurationMinutes,
    qrToken,
    qrExpiresAt,
  });

  await store.insertHostAssignment(session.id, input.hostId, 'initial_host');

  return session;
};
