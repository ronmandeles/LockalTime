import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../middleware/api-error';

export type SessionType = 'solo' | 'dynamic_qr' | 'static_qr';
export type SessionStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type DurationMode = 'fixed' | 'open_ended';
export type HostAssignmentReason = 'initial_host' | 'migration';
export type DisconnectReason = 'emergency_exit' | 'involuntary_disconnect' | 'session_ended';

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
  readonly createdAt: string;
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
});
