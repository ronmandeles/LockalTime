import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../middleware/api-error';

export type SessionType = 'solo' | 'dynamic_qr' | 'static_qr';
export type SessionStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type DurationMode = 'fixed' | 'open_ended';
export type HostAssignmentReason = 'initial_host' | 'migration';
export type DisconnectReason = 'emergency_exit' | 'involuntary_disconnect' | 'session_ended';
export type ExitReason = 'completed' | 'emergency_exit' | 'disconnected';
export type EndReason = 'host_ended' | 'planned_duration_reached' | 'force_terminated';
export type BonusType = 'base' | 'group_bonus' | 'completion_bonus';

// Mirrors the return values of the public.join_session() Postgres function
// exactly (supabase/migrations/20260726225700_create_join_session_function.sql)
// — that function, not this module, is the authority on join outcomes.
export type JoinOutcome =
  | 'joined'
  | 'already_joined'
  | 'not_found'
  | 'not_joinable'
  | 'invalid_token'
  | 'expired'
  | 'at_capacity';

export interface SessionRecord {
  readonly id: string;
  readonly hostId: string;
  readonly venueId: string | null;
  readonly type: SessionType;
  readonly status: SessionStatus;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly qrToken: string | null;
  readonly qrExpiresAt: string | null;
  // Set at creation (Phase 4: sessions activate immediately, see
  // create-session.ts) — never null for a session created through this
  // path, but typed nullable to match the DB column's real shape.
  readonly startedAt: string | null;
  readonly createdAt: string;
}

// Narrower than SessionRecord — only what end-session.ts needs to validate
// and time a close, not every column create-session.ts cares about.
export interface SessionSummary {
  readonly id: string;
  readonly hostId: string;
  readonly status: SessionStatus;
  readonly startedAt: string | null;
}

export interface PresenceIntervalRow {
  readonly userId: string;
  readonly joinedAt: string;
  // Always non-null by the time end-session.ts reads these — it closes
  // every open interval first, in the same call.
  readonly leftAt: string | null;
  readonly blockerReadyAt: string | null;
  readonly disconnectReason: DisconnectReason | null;
}

export interface FinalizedParticipantInput {
  readonly userId: string;
  readonly isHost: boolean;
  readonly exitReason: ExitReason;
  readonly totalMinutesPresent: number;
  readonly groupBonusEarned: boolean;
  readonly completionBonusEarned: boolean;
  readonly pointsEarned: number;
}

export interface RewardsHistoryRowInput {
  readonly userId: string;
  readonly sessionId: string;
  readonly points: number;
  readonly bonusType: BonusType;
}

export interface NewSessionInput {
  readonly id: string;
  readonly hostId: string;
  readonly venueId: string | null;
  readonly type: SessionType;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly qrToken: string | null;
  readonly qrExpiresAt: string | null;
  readonly status: SessionStatus;
  readonly startedAt: string;
}

// Thin persistence seam over the sessions/session_host_assignments tables —
// lets the create-session service (and its tests) depend on this narrow
// interface instead of the full Supabase query builder, matching the
// dependency-injection shape already used for testability elsewhere in the
// repo (e.g. the mobile app's service modules).
export interface SessionsStore {
  insertSession(input: NewSessionInput): Promise<SessionRecord>;
  insertHostAssignment(
    sessionId: string,
    userId: string,
    reason: HostAssignmentReason,
  ): Promise<void>;
  // Delegates to the join_session() DB function — see that migration for
  // why this can't be "check capacity, then insert" from Node.
  joinSession(
    sessionId: string,
    userId: string,
    token: string,
    maxParticipants: number,
  ): Promise<JoinOutcome>;
  // Closes the caller's own open presence interval. Returns false if there
  // was none to close (already left, or never joined) — a single UPDATE
  // scoped to one row, so no TOCTOU concern the way join has.
  closeOpenInterval(sessionId: string, userId: string, reason: DisconnectReason): Promise<boolean>;
  // Opens a presence interval directly, bypassing join_session() — used
  // only for the host's own interval at session creation (Phase 4), since
  // the host isn't "joining" through a QR token/capacity check the way a
  // participant does.
  insertPresenceInterval(sessionId: string, userId: string, joinedAt: string): Promise<void>;

  // --- Phase 4: session-end / finalization ---
  getSessionSummary(sessionId: string): Promise<SessionSummary | null>;
  // Closes every still-open interval for the session in one statement,
  // disconnect_reason='session_ended' — the anchor end-session.ts uses to
  // tell "present at the end" (-> exit_reason 'completed') apart from
  // "already closed some other way" (emergency_exit / involuntary_disconnect).
  closeAllOpenIntervals(sessionId: string, endedAt: string): Promise<void>;
  // Every interval ever recorded for the session, across every participant
  // (including ones already finalized via emergency-exit) — end-session.ts
  // needs the full set to reconstruct an accurate concurrent-count timeline
  // for the participants it still has to finalize.
  getPresenceIntervals(sessionId: string): Promise<readonly PresenceIntervalRow[]>;
  // user_ids that already have a session_participants row (finalized
  // inline at their own emergency-exit moment) — end-session.ts still needs
  // their intervals for the timeline above, but must not re-finalize or
  // double-write rewards_history for them.
  getFinalizedParticipantUserIds(sessionId: string): Promise<ReadonlySet<string>>;
  writeSessionParticipants(
    sessionId: string,
    rows: readonly FinalizedParticipantInput[],
  ): Promise<void>;
  insertRewardsHistory(rows: readonly RewardsHistoryRowInput[]): Promise<void>;
  markSessionEnded(input: {
    sessionId: string;
    endedAt: string;
    endedBy: string | null;
    endReason: EndReason;
  }): Promise<void>;
}

interface SessionRow {
  id: string;
  host_id: string;
  venue_id: string | null;
  type: SessionType;
  status: SessionStatus;
  duration_mode: DurationMode;
  planned_duration_minutes: number | null;
  qr_token: string | null;
  qr_expires_at: string | null;
  started_at: string | null;
  created_at: string;
}

const toSessionRecord = (row: SessionRow): SessionRecord => ({
  id: row.id,
  hostId: row.host_id,
  venueId: row.venue_id,
  type: row.type,
  status: row.status,
  durationMode: row.duration_mode,
  plannedDurationMinutes: row.planned_duration_minutes,
  qrToken: row.qr_token,
  qrExpiresAt: row.qr_expires_at,
  startedAt: row.started_at,
  createdAt: row.created_at,
});

export const createSupabaseSessionsStore = (client: SupabaseClient): SessionsStore => ({
  async insertSession(input) {
    const { data, error } = await client
      .from('sessions')
      .insert({
        id: input.id,
        host_id: input.hostId,
        venue_id: input.venueId,
        type: input.type,
        duration_mode: input.durationMode,
        planned_duration_minutes: input.plannedDurationMinutes,
        qr_token: input.qrToken,
        qr_expires_at: input.qrExpiresAt,
        status: input.status,
        started_at: input.startedAt,
      })
      .select()
      .single<SessionRow>();

    if (error !== null) {
      throw new ApiError(500, 'session_create_failed', error.message);
    }
    return toSessionRecord(data);
  },

  async insertHostAssignment(sessionId, userId, reason) {
    const { error } = await client
      .from('session_host_assignments')
      .insert({ session_id: sessionId, user_id: userId, reason });

    if (error !== null) {
      throw new ApiError(500, 'session_create_failed', error.message);
    }
  },

  async joinSession(sessionId, userId, token, maxParticipants) {
    const { data, error } = await client.rpc('join_session', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_token: token,
      p_max_participants: maxParticipants,
    });

    if (error !== null) {
      throw new ApiError(500, 'session_join_failed', error.message);
    }
    return data as JoinOutcome;
  },

  async closeOpenInterval(sessionId, userId, reason) {
    const { data, error } = await client
      .from('session_presence_intervals')
      .update({ left_at: new Date().toISOString(), disconnect_reason: reason })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('left_at', null)
      .select('id');

    if (error !== null) {
      throw new ApiError(500, 'session_leave_failed', error.message);
    }
    return (data?.length ?? 0) > 0;
  },

  async insertPresenceInterval(sessionId, userId, joinedAt) {
    const { error } = await client
      .from('session_presence_intervals')
      .insert({ session_id: sessionId, user_id: userId, joined_at: joinedAt });

    if (error !== null) {
      throw new ApiError(500, 'session_create_failed', error.message);
    }
  },

  async getSessionSummary(sessionId) {
    const { data, error } = await client
      .from('sessions')
      .select('id, host_id, status, started_at')
      .eq('id', sessionId)
      .maybeSingle<{
        id: string;
        host_id: string;
        status: SessionStatus;
        started_at: string | null;
      }>();

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
    if (data === null) {
      return null;
    }
    return { id: data.id, hostId: data.host_id, status: data.status, startedAt: data.started_at };
  },

  async closeAllOpenIntervals(sessionId, endedAt) {
    const { error } = await client
      .from('session_presence_intervals')
      .update({ left_at: endedAt, disconnect_reason: 'session_ended' })
      .eq('session_id', sessionId)
      .is('left_at', null);

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
  },

  async getPresenceIntervals(sessionId) {
    const { data, error } = await client
      .from('session_presence_intervals')
      .select('user_id, joined_at, left_at, blocker_ready_at, disconnect_reason')
      .eq('session_id', sessionId);

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
    return (data ?? []).map((row) => ({
      userId: row.user_id as string,
      joinedAt: row.joined_at as string,
      leftAt: row.left_at as string | null,
      blockerReadyAt: row.blocker_ready_at as string | null,
      disconnectReason: row.disconnect_reason as DisconnectReason | null,
    }));
  },

  async getFinalizedParticipantUserIds(sessionId) {
    const { data, error } = await client
      .from('session_participants')
      .select('user_id')
      .eq('session_id', sessionId);

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
    return new Set((data ?? []).map((row) => row.user_id as string));
  },

  async writeSessionParticipants(sessionId, rows) {
    if (rows.length === 0) {
      return;
    }
    const { error } = await client.from('session_participants').insert(
      rows.map((row) => ({
        session_id: sessionId,
        user_id: row.userId,
        is_host: row.isHost,
        total_minutes_present: row.totalMinutesPresent,
        exit_reason: row.exitReason,
        group_bonus_earned: row.groupBonusEarned,
        completion_bonus_earned: row.completionBonusEarned,
        points_earned: row.pointsEarned,
      })),
    );

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
  },

  async insertRewardsHistory(rows) {
    if (rows.length === 0) {
      return;
    }
    const { error } = await client.from('rewards_history').insert(
      rows.map((row) => ({
        user_id: row.userId,
        session_id: row.sessionId,
        points: row.points,
        bonus_type: row.bonusType,
      })),
    );

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
  },

  async markSessionEnded(input) {
    const { error } = await client
      .from('sessions')
      .update({
        status: 'completed',
        ended_at: input.endedAt,
        ended_by: input.endedBy,
        end_reason: input.endReason,
      })
      .eq('id', input.sessionId);

    if (error !== null) {
      throw new ApiError(500, 'session_end_failed', error.message);
    }
  },
});
