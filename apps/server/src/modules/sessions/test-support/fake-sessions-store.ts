import type {
  ActiveSessionSummary,
  DisconnectReason,
  DurationMode,
  EndReason,
  FinalizedParticipantInput,
  PresenceIntervalRow,
  RewardsHistoryRowInput,
  SessionsStore,
  SessionStatus,
} from '../sessions-store';

// A small in-memory relational fake covering every SessionsStore method —
// built for sweep.test.ts, whose scenarios exercise auto-close (which
// calls through to endSession(), itself needing most of the store's
// surface) alongside host-migration and stale-reconciliation in the same
// pass. Sharing one realistic fake here reads far better than re-deriving
// ad hoc per-field mocks for every test.

export interface FakeSession {
  readonly id: string;
  hostId: string;
  status: SessionStatus;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly startedAt: string | null;
  endedAt?: string;
  endedBy?: string | null;
  endReason?: EndReason;
}

export interface FakeInterval {
  sessionId: string;
  userId: string;
  joinedAt: string;
  leftAt: string | null;
  blockerReadyAt: string | null;
  disconnectReason: DisconnectReason | null;
}

export interface FakeHostAssignment {
  sessionId: string;
  userId: string;
  reason: 'initial_host' | 'migration';
  unassignedAt: string | null;
}

export interface FakeStoreState {
  readonly sessions: FakeSession[];
  readonly intervals: FakeInterval[];
  readonly hostAssignments: FakeHostAssignment[];
  readonly participants: (FinalizedParticipantInput & { sessionId: string })[];
  readonly rewards: RewardsHistoryRowInput[];
}

export const buildFakeSessionsStore = (
  initial: Partial<FakeStoreState> = {},
): SessionsStore & { readonly state: FakeStoreState } => {
  const state: FakeStoreState = {
    sessions: initial.sessions ?? [],
    intervals: initial.intervals ?? [],
    hostAssignments: initial.hostAssignments ?? [],
    participants: initial.participants ?? [],
    rewards: initial.rewards ?? [],
  };

  return {
    state,
    async insertSession(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async insertHostAssignment(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async joinSession(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async rejoinSession(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async closeOpenInterval(sessionId, userId, reason) {
      const interval = state.intervals.find(
        (row) => row.sessionId === sessionId && row.userId === userId && row.leftAt === null,
      );
      if (interval === undefined) {
        return false;
      }
      interval.leftAt = new Date().toISOString();
      interval.disconnectReason = reason;
      return true;
    },
    async insertPresenceInterval(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async markBlockerReady(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async getSessionSummary(sessionId) {
      const session = state.sessions.find((row) => row.id === sessionId);
      if (session === undefined) {
        return null;
      }
      return {
        id: session.id,
        hostId: session.hostId,
        status: session.status,
        startedAt: session.startedAt,
      };
    },
    async closeAllOpenIntervals(sessionId, endedAt) {
      for (const interval of state.intervals) {
        if (interval.sessionId === sessionId && interval.leftAt === null) {
          interval.leftAt = endedAt;
          interval.disconnectReason = 'session_ended';
        }
      }
    },
    async getPresenceIntervals(sessionId): Promise<readonly PresenceIntervalRow[]> {
      return state.intervals
        .filter((row) => row.sessionId === sessionId)
        .map((row) => ({
          userId: row.userId,
          joinedAt: row.joinedAt,
          leftAt: row.leftAt,
          blockerReadyAt: row.blockerReadyAt,
          disconnectReason: row.disconnectReason,
        }));
    },
    async getUserPresenceIntervals(): Promise<never> {
      throw new Error('not used by sweep.test.ts');
    },
    async getFinalizedParticipantUserIds(sessionId) {
      return new Set(
        state.participants.filter((row) => row.sessionId === sessionId).map((row) => row.userId),
      );
    },
    async writeSessionParticipants(sessionId, rows) {
      for (const row of rows) {
        state.participants.push({ ...row, sessionId });
      }
    },
    async insertRewardsHistory(rows) {
      state.rewards.push(...rows);
    },
    async markSessionEnded(input) {
      const session = state.sessions.find((row) => row.id === input.sessionId);
      if (session === undefined) {
        return;
      }
      session.status = 'completed';
      session.endedAt = input.endedAt;
      session.endedBy = input.endedBy;
      session.endReason = input.endReason;
    },
    async listActiveSessions(): Promise<readonly ActiveSessionSummary[]> {
      return state.sessions
        .filter((row) => row.status === 'active')
        .map((row) => ({
          id: row.id,
          hostId: row.hostId,
          durationMode: row.durationMode,
          plannedDurationMinutes: row.plannedDurationMinutes,
          startedAt: row.startedAt,
        }));
    },
    async migrateHost(sessionId, oldHostId, newHostId, migratedAt) {
      const session = state.sessions.find((row) => row.id === sessionId);
      if (session !== undefined) {
        session.hostId = newHostId;
      }
      const oldAssignment = state.hostAssignments.find(
        (row) =>
          row.sessionId === sessionId && row.userId === oldHostId && row.unassignedAt === null,
      );
      if (oldAssignment !== undefined) {
        oldAssignment.unassignedAt = migratedAt;
      }
      state.hostAssignments.push({
        sessionId,
        userId: newHostId,
        reason: 'migration',
        unassignedAt: null,
      });
    },
  };
};
