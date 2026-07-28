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

// Mirrors the return values of the public.rejoin_session() Postgres function
// exactly (supabase/migrations/20260728140000_create_rejoin_session_function.sql).
// No 'invalid_token'/'expired' — rejoin never checks a token — but adds
// 'not_a_participant' for a user who was never in this session at all.
export type RejoinOutcome =
  | 'joined'
  | 'already_joined'
  | 'not_found'
  | 'not_joinable'
  | 'not_a_participant'
  | 'at_capacity';

// Mirrors the return values of the public.join_venue_session() Postgres
// function exactly (20260729000300_static_qr_venue_token.sql) — Phase 6
// task 2's venue-scoped counterpart to join_session(). No 'expired' (a
// venue token has no expiry by design); 'invalid_token' can still happen
// at the DB layer even after Node's own signature check passes, if the
// token no longer matches the venue's CURRENT qr_token column (the venue
// owner regenerated it since this code was printed) -- same "checked
// twice, for two different reasons" shape as join_session(). Adds
// 'venue_not_found' and 'no_active_session' since resolving WHICH session
// to join is this function's job, not the caller's.
export type VenueJoinOutcome =
  | 'joined'
  | 'already_joined'
  | 'invalid_token'
  | 'venue_not_found'
  | 'no_active_session'
  | 'at_capacity';

export interface VenueJoinResult {
  readonly outcome: VenueJoinOutcome;
  // Non-null on every outcome except venue_not_found/no_active_session —
  // there's no session to identify until one's been resolved.
  readonly sessionId: string | null;
}

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

// What the sweep worker (sweep.ts) needs to know about every currently
// active session — a third, even narrower projection alongside
// SessionRecord/SessionSummary, matching each caller's actual needs rather
// than reusing one wide row shape everywhere.
export interface ActiveSessionSummary {
  readonly id: string;
  readonly hostId: string;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly startedAt: string | null;
}

// Phase 6 task 4: everything preview-session.ts needs to build a
// SessionPreview — yet another narrower projection than SessionRecord,
// matching that one caller's needs (no qrToken/qrExpiresAt/hostId, since a
// preview must never reveal anything a non-participant shouldn't see).
export interface SessionPreviewRow {
  readonly id: string;
  readonly type: SessionType;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly status: SessionStatus;
  readonly startedAt: string | null;
  readonly venueId: string | null;
}

// Phase 6 task 5: the raw shape get_venue_metrics() returns — aggregates
// only, never individual customers (ARCHITECTURE.md §10's MVP scope).
export interface VenueMetricsRow {
  readonly concurrentActiveCustomers: number;
  readonly sessionsInWindow: number;
  readonly avgMinutesPerCustomer: number;
}

export type DeviceTrustTier = 'trusted' | 'unverified';

export interface PresenceIntervalRow {
  readonly userId: string;
  readonly joinedAt: string;
  // Always non-null by the time end-session.ts reads these — it closes
  // every open interval first, in the same call.
  readonly leftAt: string | null;
  readonly blockerReadyAt: string | null;
  readonly disconnectReason: DisconnectReason | null;
  // Phase 6 tasks 8-9: already enforcement-gated at write time
  // (markDeviceTrust -> attestation/trust-tier.ts) — 'trusted' unless
  // attestation reported no integrity signal AND enforcement was enabled.
  readonly deviceTrustTier: DeviceTrustTier;
}

export interface FinalizedParticipantInput {
  readonly userId: string;
  readonly isHost: boolean;
  readonly exitReason: ExitReason;
  readonly totalMinutesPresent: number;
  readonly groupBonusEarned: boolean;
  readonly completionBonusEarned: boolean;
  readonly pointsEarned: number;
  // Phase 6 tasks 8-9: 'unverified' if ANY of the participant's intervals
  // this session was unverified — feeds apply_session_stats()'s
  // streak-exclusion gate (backlog's "exclude from bonus/streak only").
  readonly deviceTrustTier: DeviceTrustTier;
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
  // Delegates to the rejoin_session() DB function — the token-free
  // counterpart to joinSession() above, authorized by prior participation
  // instead of a QR token (see that migration's header for why a still-valid
  // token can't be assumed for this path).
  rejoinSession(sessionId: string, userId: string, maxParticipants: number): Promise<RejoinOutcome>;
  // Delegates to the join_venue_session() DB function — Phase 6 task 2's
  // venue-scoped counterpart to joinSession(). Resolves "the venue's
  // currently active static_qr session" and joins it atomically; see that
  // migration's header for why Node can't split resolve-then-join into two
  // round trips.
  joinVenueSession(
    venueId: string,
    token: string,
    userId: string,
    maxParticipants: number,
  ): Promise<VenueJoinResult>;

  // --- Phase 6 task 4: session preview (read-only, never joins) ---
  // A plain read, never an RPC — unlike join, there's no capacity/token
  // race to serialize against; a preview reflects a snapshot, not a
  // decision. Read-only aggregates like this are the one place a direct
  // Supabase read would normally be allowed (.claude/skills/
  // supabase-integration/SKILL.md), but this needs both a signature check
  // (venue vs. session token) and a JOIN across tables a non-participant's
  // RLS can't see (is_session_participant() denies a stranger a session
  // row entirely) — so it stays a Node endpoint.
  getSessionPreview(sessionId: string): Promise<SessionPreviewRow | null>;
  getOpenParticipantCount(sessionId: string): Promise<number>;
  // Resolves a venue's CURRENTLY active static_qr session id, read-only —
  // the preview counterpart to join_venue_session()'s own resolution, but
  // without the row lock or the join side effect (a preview must never
  // create a presence interval).
  getActiveStaticQrSessionId(venueId: string): Promise<string | null>;

  // --- Phase 6 task 5: B2B metrics ---
  // Delegates to the get_venue_metrics() DB function — see that
  // migration's header for why this is one SQL function rather than
  // several round trips averaged in Node.
  getVenueMetrics(venueId: string, windowStart: string): Promise<VenueMetricsRow>;

  // Closes the caller's own open presence interval. Returns false if there
  // was none to close (already left, or never joined) — a single UPDATE
  // scoped to one row, so no TOCTOU concern the way join has.
  closeOpenInterval(sessionId: string, userId: string, reason: DisconnectReason): Promise<boolean>;
  // Opens a presence interval directly, bypassing join_session() — used
  // only for the host's own interval at session creation (Phase 4), since
  // the host isn't "joining" through a QR token/capacity check the way a
  // participant does.
  insertPresenceInterval(sessionId: string, userId: string, joinedAt: string): Promise<void>;
  // Best-effort, idempotent: sets blocker_ready_at on the caller's open
  // interval only if it isn't already set (a second call never shifts an
  // earlier legitimate timestamp), and silently no-ops if there's no open
  // interval at all — this is an advisory signal for the group bonus
  // threshold (ARCHITECTURE.md §7), never something that can fail a
  // request the way join/leave do.
  markBlockerReady(sessionId: string, userId: string, readyAt: string): Promise<void>;
  // Phase 6 tasks 8-9: a follow-up update after join, exactly
  // markBlockerReady's precedent — scoped to the caller's open interval,
  // never blocks the join itself (called fire-and-forget after a
  // successful join, only when an attestation token was provided).
  markDeviceTrust(sessionId: string, userId: string, tier: DeviceTrustTier): Promise<void>;

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
  // Just one user's intervals for the session — used for inline
  // emergency-exit finalization, which never needs anyone else's data
  // (computeForfeitedReward() forfeits both bonuses unconditionally).
  getUserPresenceIntervals(
    sessionId: string,
    userId: string,
  ): Promise<readonly PresenceIntervalRow[]>;
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

  // --- Phase 4: sweep worker (host migration + stale reconciliation + auto-close) ---
  listActiveSessions(): Promise<readonly ActiveSessionSummary[]>;
  // Flips sessions.host_id, closes the old host's session_host_assignments
  // row (unassigned_at), and opens a new one with reason='migration' — all
  // three in one call so sweep.ts's caller never has to sequence them.
  migrateHost(
    sessionId: string,
    oldHostId: string,
    newHostId: string,
    migratedAt: string,
  ): Promise<void>;

  // --- Phase 5: gamification & stats ---
  // Delegates to the apply_session_stats() DB function — accumulates one
  // finalized session_participants row into user_stats/user_stats_daily/
  // user_streaks/user_milestones (+ a rewards_history row for any milestone
  // crossed). See that migration's header for why this can't be a Node-side
  // read-modify-write: it's called from two independent finalization paths
  // (end-session.ts, finalize-emergency-exit.ts) that can race each other
  // and the sweep worker for the same user across different sessions.
  // Exactly-once per (sessionId, userId) — a second call is a silent no-op,
  // never an error, so callers don't need to track whether they already
  // applied a given row.
  applySessionStats(
    sessionId: string,
    userId: string,
    finalizedAt: string,
    streakGraceHours: number,
    deviceTrustTier: DeviceTrustTier,
  ): Promise<void>;
  // Zeroes current_streak for every user_streaks row whose grace window has
  // already passed as of `asOf` — the passage-of-time half of streak
  // bookkeeping that apply_session_stats() (an event-driven function) can
  // never do on its own. A plain scoped UPDATE, not a SECURITY DEFINER
  // function: there's nothing atomicity-sensitive about zeroing an
  // already-expired streak (unlike apply_session_stats()'s cross-table
  // read-decide-write), so the extra machinery isn't warranted.
  expireStreaks(asOf: string): Promise<void>;
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

  async rejoinSession(sessionId, userId, maxParticipants) {
    const { data, error } = await client.rpc('rejoin_session', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_max_participants: maxParticipants,
    });

    if (error !== null) {
      throw new ApiError(500, 'session_rejoin_failed', error.message);
    }
    return data as RejoinOutcome;
  },

  async joinVenueSession(venueId, token, userId, maxParticipants) {
    const { data, error } = await client
      .rpc('join_venue_session', {
        p_venue_id: venueId,
        p_token: token,
        p_user_id: userId,
        p_max_participants: maxParticipants,
      })
      .single<{ outcome: string; session_id: string | null }>();

    if (error !== null) {
      throw new ApiError(500, 'venue_session_join_failed', error.message);
    }
    return { outcome: data.outcome as VenueJoinOutcome, sessionId: data.session_id };
  },

  async getSessionPreview(sessionId) {
    const { data, error } = await client
      .from('sessions')
      .select('id, type, duration_mode, planned_duration_minutes, status, started_at, venue_id')
      .eq('id', sessionId)
      .maybeSingle<{
        id: string;
        type: SessionType;
        duration_mode: DurationMode;
        planned_duration_minutes: number | null;
        status: SessionStatus;
        started_at: string | null;
        venue_id: string | null;
      }>();

    if (error !== null) {
      throw new ApiError(500, 'session_preview_failed', error.message);
    }
    if (data === null) {
      return null;
    }
    return {
      id: data.id,
      type: data.type,
      durationMode: data.duration_mode,
      plannedDurationMinutes: data.planned_duration_minutes,
      status: data.status,
      startedAt: data.started_at,
      venueId: data.venue_id,
    };
  },

  async getOpenParticipantCount(sessionId) {
    const { count, error } = await client
      .from('session_presence_intervals')
      .select('*', { count: 'exact', head: true })
      .eq('session_id', sessionId)
      .is('left_at', null);

    if (error !== null) {
      throw new ApiError(500, 'session_preview_failed', error.message);
    }
    return count ?? 0;
  },

  async getActiveStaticQrSessionId(venueId) {
    const { data, error } = await client
      .from('sessions')
      .select('id')
      .eq('venue_id', venueId)
      .eq('type', 'static_qr')
      .eq('status', 'active')
      .maybeSingle<{ id: string }>();

    if (error !== null) {
      throw new ApiError(500, 'session_preview_failed', error.message);
    }
    return data === null ? null : data.id;
  },

  async getVenueMetrics(venueId, windowStart) {
    const { data, error } = await client
      .rpc('get_venue_metrics', { p_venue_id: venueId, p_window_start: windowStart })
      .single<{
        concurrent_active_customers: number;
        sessions_in_window: number;
        avg_minutes_per_customer: number | string;
      }>();

    if (error !== null) {
      throw new ApiError(500, 'venue_metrics_failed', error.message);
    }
    return {
      concurrentActiveCustomers: data.concurrent_active_customers,
      sessionsInWindow: data.sessions_in_window,
      // Postgres numeric comes back as a string over the Data API to
      // avoid float precision loss -- Number() here is safe (never
      // money-equivalent, this is a display aggregate only).
      avgMinutesPerCustomer: Number(data.avg_minutes_per_customer),
    };
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

  async markBlockerReady(sessionId, userId, readyAt) {
    const { error } = await client
      .from('session_presence_intervals')
      .update({ blocker_ready_at: readyAt })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('left_at', null)
      .is('blocker_ready_at', null);

    // Best-effort by design (see the interface doc comment) — a failure
    // here never blocks the caller; still logged server-side via the
    // thrown ApiError being caught by the router's .catch(next), which
    // renders a 500 the client (app-blocker start success path) never
    // waits on or surfaces to the user.
    if (error !== null) {
      throw new ApiError(500, 'blocker_ready_failed', error.message);
    }
  },

  async markDeviceTrust(sessionId, userId, tier) {
    const { error } = await client
      .from('session_presence_intervals')
      .update({ device_trust_tier: tier })
      .eq('session_id', sessionId)
      .eq('user_id', userId)
      .is('left_at', null);

    // Best-effort, same posture as markBlockerReady — a failure here never
    // blocks the join it follows.
    if (error !== null) {
      throw new ApiError(500, 'device_trust_failed', error.message);
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
      .select('user_id, joined_at, left_at, blocker_ready_at, disconnect_reason, device_trust_tier')
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
      deviceTrustTier: row.device_trust_tier as DeviceTrustTier,
    }));
  },

  async getUserPresenceIntervals(sessionId, userId) {
    const { data, error } = await client
      .from('session_presence_intervals')
      .select('user_id, joined_at, left_at, blocker_ready_at, disconnect_reason, device_trust_tier')
      .eq('session_id', sessionId)
      .eq('user_id', userId);

    if (error !== null) {
      throw new ApiError(500, 'session_leave_failed', error.message);
    }
    return (data ?? []).map((row) => ({
      userId: row.user_id as string,
      joinedAt: row.joined_at as string,
      leftAt: row.left_at as string | null,
      blockerReadyAt: row.blocker_ready_at as string | null,
      disconnectReason: row.disconnect_reason as DisconnectReason | null,
      deviceTrustTier: row.device_trust_tier as DeviceTrustTier,
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
        device_trust_tier: row.deviceTrustTier,
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

  async listActiveSessions() {
    const { data, error } = await client
      .from('sessions')
      .select('id, host_id, duration_mode, planned_duration_minutes, started_at')
      .eq('status', 'active');

    if (error !== null) {
      throw new ApiError(500, 'session_sweep_failed', error.message);
    }
    return (data ?? []).map((row) => ({
      id: row.id as string,
      hostId: row.host_id as string,
      durationMode: row.duration_mode as DurationMode,
      plannedDurationMinutes: row.planned_duration_minutes as number | null,
      startedAt: row.started_at as string | null,
    }));
  },

  async migrateHost(sessionId, oldHostId, newHostId, migratedAt) {
    const { error: sessionError } = await client
      .from('sessions')
      .update({ host_id: newHostId })
      .eq('id', sessionId);
    if (sessionError !== null) {
      throw new ApiError(500, 'host_migration_failed', sessionError.message);
    }

    const { error: unassignError } = await client
      .from('session_host_assignments')
      .update({ unassigned_at: migratedAt })
      .eq('session_id', sessionId)
      .eq('user_id', oldHostId)
      .is('unassigned_at', null);
    if (unassignError !== null) {
      throw new ApiError(500, 'host_migration_failed', unassignError.message);
    }

    const { error: assignError } = await client
      .from('session_host_assignments')
      .insert({ session_id: sessionId, user_id: newHostId, reason: 'migration' });
    if (assignError !== null) {
      throw new ApiError(500, 'host_migration_failed', assignError.message);
    }
  },

  async applySessionStats(sessionId, userId, finalizedAt, streakGraceHours, deviceTrustTier) {
    const { error } = await client.rpc('apply_session_stats', {
      p_session_id: sessionId,
      p_user_id: userId,
      p_finalized_at: finalizedAt,
      p_streak_grace_hours: streakGraceHours,
      p_device_trust_tier: deviceTrustTier,
    });

    if (error !== null) {
      throw new ApiError(500, 'stats_apply_failed', error.message);
    }
  },

  async expireStreaks(asOf) {
    const { error } = await client
      .from('user_streaks')
      .update({ current_streak: 0 })
      .lt('streak_grace_expires_at', asOf)
      .gt('current_streak', 0);

    if (error !== null) {
      throw new ApiError(500, 'streak_expiry_failed', error.message);
    }
  },
});
