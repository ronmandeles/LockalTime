import { QR_TOKEN_TTL_MINUTES } from '../../config/constants';
import { createSession } from './create-session';
import { verifyQrToken } from './qr-token';
import type {
  HostAssignmentReason,
  NewSessionInput,
  SessionRecord,
  SessionsStore,
} from './sessions-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const HOST_ID = '55555555-5555-5555-5555-555555555555';

const buildFakeStore = (): SessionsStore & {
  insertedSession: NewSessionInput | null;
  hostAssignment: { sessionId: string; userId: string; reason: HostAssignmentReason } | null;
  hostPresenceInterval: { sessionId: string; userId: string; joinedAt: string } | null;
} => {
  const store = {
    insertedSession: null as NewSessionInput | null,
    hostAssignment: null as {
      sessionId: string;
      userId: string;
      reason: HostAssignmentReason;
    } | null,
    hostPresenceInterval: null as { sessionId: string; userId: string; joinedAt: string } | null,
    async insertSession(input: NewSessionInput): Promise<SessionRecord> {
      store.insertedSession = input;
      return {
        id: input.id,
        hostId: input.hostId,
        venueId: input.venueId,
        type: input.type,
        status: input.status,
        durationMode: input.durationMode,
        plannedDurationMinutes: input.plannedDurationMinutes,
        qrToken: input.qrToken,
        qrExpiresAt: input.qrExpiresAt,
        startedAt: input.startedAt,
        createdAt: new Date().toISOString(),
      };
    },
    async insertHostAssignment(
      sessionId: string,
      userId: string,
      reason: HostAssignmentReason,
    ): Promise<void> {
      store.hostAssignment = { sessionId, userId, reason };
    },
    async insertPresenceInterval(
      sessionId: string,
      userId: string,
      joinedAt: string,
    ): Promise<void> {
      store.hostPresenceInterval = { sessionId, userId, joinedAt };
    },
    async markBlockerReady(): Promise<void> {},
    // Not exercised by createSession — present only to satisfy the
    // SessionsStore interface.
    async joinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async rejoinSession(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeOpenInterval(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getSessionSummary(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async closeAllOpenIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getUserPresenceIntervals(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getFinalizedParticipantUserIds(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async writeSessionParticipants(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async insertRewardsHistory(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async markSessionEnded(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async listActiveSessions(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async migrateHost(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async applySessionStats(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async expireStreaks(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

describe('createSession', () => {
  it('creates a solo session with no QR token', async () => {
    const store = buildFakeStore();

    const session = await createSession(store, QR_SECRET, {
      hostId: HOST_ID,
      type: 'solo',
      durationMode: 'fixed',
      plannedDurationMinutes: 30,
      venueId: null,
    });

    expect(session.qrToken).toBeNull();
    expect(session.qrExpiresAt).toBeNull();
  });

  it('creates a dynamic_qr session with a verifiable token expiring at the configured TTL', async () => {
    const store = buildFakeStore();
    const before = Date.now();

    const session = await createSession(store, QR_SECRET, {
      hostId: HOST_ID,
      type: 'dynamic_qr',
      durationMode: 'fixed',
      plannedDurationMinutes: 45,
      venueId: null,
    });

    expect(session.qrToken).not.toBeNull();
    expect(verifyQrToken(session.qrToken as string, QR_SECRET)).toEqual({ sessionId: session.id });

    const expiresAt = new Date(session.qrExpiresAt as string).getTime();
    const expectedExpiry = before + QR_TOKEN_TTL_MINUTES * 60_000;
    expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThan(5_000);
  });

  it('records the host as the initial host in the audit trail', async () => {
    const store = buildFakeStore();

    const session = await createSession(store, QR_SECRET, {
      hostId: HOST_ID,
      type: 'solo',
      durationMode: 'open_ended',
      plannedDurationMinutes: null,
      venueId: null,
    });

    expect(store.hostAssignment).toEqual({
      sessionId: session.id,
      userId: HOST_ID,
      reason: 'initial_host',
    });
  });

  it('activates the session immediately, setting status and started_at at creation', async () => {
    const store = buildFakeStore();
    const before = Date.now();

    const session = await createSession(store, QR_SECRET, {
      hostId: HOST_ID,
      type: 'solo',
      durationMode: 'fixed',
      plannedDurationMinutes: 30,
      venueId: null,
    });

    expect(session.status).toBe('active');
    expect(session.startedAt).not.toBeNull();
    const startedAtMs = new Date(session.startedAt as string).getTime();
    expect(startedAtMs).toBeGreaterThanOrEqual(before);
    expect(startedAtMs).toBeLessThan(before + 5_000);
    expect(store.insertedSession?.status).toBe('active');
    expect(store.insertedSession?.startedAt).toBe(session.startedAt);
  });

  it('gives the host their own open presence interval at creation, starting at started_at', async () => {
    const store = buildFakeStore();

    const session = await createSession(store, QR_SECRET, {
      hostId: HOST_ID,
      type: 'dynamic_qr',
      durationMode: 'fixed',
      plannedDurationMinutes: 30,
      venueId: null,
    });

    expect(store.hostPresenceInterval).toEqual({
      sessionId: session.id,
      userId: HOST_ID,
      joinedAt: session.startedAt,
    });
  });

  it('generates a fresh session id for every call', async () => {
    const store = buildFakeStore();
    const input = {
      hostId: HOST_ID,
      type: 'solo' as const,
      durationMode: 'open_ended' as const,
      plannedDurationMinutes: null,
      venueId: null,
    };

    const first = await createSession(store, QR_SECRET, input);
    const second = await createSession(store, QR_SECRET, input);

    expect(first.id).not.toBe(second.id);
  });
});
