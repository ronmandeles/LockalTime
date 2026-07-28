import { getSupabaseClient } from './supabase-client';
import type { ExitReasonRow, SessionRowType } from './session-repository';

// Direct, RLS-protected Supabase reads for Phase 5's gamification/stats
// surfaces (Home summary, History, Stats screens) — same posture as
// session-repository.ts: these are read-only aggregates the user is
// entitled to see (.claude/skills/supabase-integration/SKILL.md), never
// writes, and never recomputed here (Money-Equivalent Logic Rule) — every
// number already comes pre-computed from apply_session_stats()
// (apps/server, Phase 5).

export interface RepositoryFailure {
  readonly message: string;
}

export type RepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryFailure };

// ── user_stats: lifetime aggregates (Home summary, Stats screen) ─────────

export interface UserStatsRow {
  readonly total_minutes: number;
  readonly total_points: number;
  readonly sessions_completed: number;
  readonly sessions_emergency_exit: number;
  readonly sessions_disconnected: number;
}

// maybeSingle, not single: a brand-new user has no row yet (created lazily
// by apply_session_stats() on their first-ever finalized session) — that's
// a real "zero" state to render, not an error.
export const fetchUserStats = async (
  userId: string,
): Promise<RepositoryResult<UserStatsRow | null>> => {
  const { data, error } = await getSupabaseClient()
    .from('user_stats')
    .select('total_minutes, total_points, sessions_completed, sessions_emergency_exit, sessions_disconnected')
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: data as unknown as UserStatsRow | null };
};

// ── user_streaks (Home summary, Stats screen) ────────────────────────────

export interface UserStreakRow {
  readonly current_streak: number;
  readonly longest_streak: number;
  readonly streak_grace_expires_at: string | null;
}

export const fetchUserStreak = async (
  userId: string,
): Promise<RepositoryResult<UserStreakRow | null>> => {
  const { data, error } = await getSupabaseClient()
    .from('user_streaks')
    .select('current_streak, longest_streak, streak_grace_expires_at')
    .eq('user_id', userId)
    .maybeSingle();

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: data as unknown as UserStreakRow | null };
};

// ── user_stats_daily: 7-day chart (Stats screen) ──────────────────────────

export interface UserStatsDailyRow {
  readonly day: string; // ISO date, e.g. "2026-08-05"
  readonly minutes: number;
  readonly points: number;
  readonly sessions: number;
}

// `fromDay` is supplied by the caller (device-local "7 days ago", see
// StatsScreen) rather than computed here — keeps this function pure and
// deterministic to test, matching the injectable-clock convention used
// throughout the server (.claude/skills/testing-standards/SKILL.md). Days
// with no session simply have no row here — the caller zero-fills for the
// chart, this function only returns what actually happened.
export const fetchDailyStats = async (
  userId: string,
  fromDay: string,
): Promise<RepositoryResult<readonly UserStatsDailyRow[]>> => {
  const { data, error } = await getSupabaseClient()
    .from('user_stats_daily')
    .select('day, minutes, points, sessions')
    .eq('user_id', userId)
    .gte('day', fromDay)
    .order('day', { ascending: true });

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: (data ?? []) as unknown as readonly UserStatsDailyRow[] };
};

// ── milestones + user_milestones: progress bar (Home) + achieved list (Stats) ──

export interface MilestoneRow {
  readonly id: string;
  readonly slug: string;
  readonly sessions_required: number;
  readonly bonus_points: number;
}

export interface MilestoneProgress {
  // Every milestone, ascending by sessions_required — global reference
  // data, same for every user.
  readonly milestones: readonly MilestoneRow[];
  readonly achievedMilestoneIds: ReadonlySet<string>;
}

// Two tables, one combined read: the ladder itself (milestones, global) and
// this user's crossings (user_milestones, own rows only). Run in parallel
// since neither depends on the other.
export const fetchMilestoneProgress = async (
  userId: string,
): Promise<RepositoryResult<MilestoneProgress>> => {
  const client = getSupabaseClient();
  const [milestonesResult, achievedResult] = await Promise.all([
    client.from('milestones').select('id, slug, sessions_required, bonus_points').order('sessions_required', {
      ascending: true,
    }),
    client.from('user_milestones').select('milestone_id').eq('user_id', userId),
  ]);

  if (milestonesResult.error !== null) {
    return { ok: false, error: { message: milestonesResult.error.message } };
  }
  if (achievedResult.error !== null) {
    return { ok: false, error: { message: achievedResult.error.message } };
  }

  const achievedRows = (achievedResult.data ?? []) as unknown as readonly {
    readonly milestone_id: string;
  }[];
  return {
    ok: true,
    value: {
      milestones: (milestonesResult.data ?? []) as unknown as readonly MilestoneRow[],
      achievedMilestoneIds: new Set(achievedRows.map((row) => row.milestone_id)),
    },
  };
};

// ── History screen: keyset-paginated past sessions ───────────────────────

export type HistoryFilter = 'solo' | 'group' | 'all';

export const HISTORY_PAGE_SIZE = 20;

export interface SessionHistoryRow {
  readonly id: string;
  readonly type: SessionRowType;
  readonly started_at: string | null;
  readonly ended_at: string;
  readonly exit_reason: ExitReasonRow | null;
  readonly total_minutes_present: number;
  readonly points_earned: number;
  readonly group_bonus_earned: boolean;
  readonly completion_bonus_earned: boolean;
}

interface RawHistoryParticipant {
  readonly exit_reason: ExitReasonRow | null;
  readonly total_minutes_present: number;
  readonly points_earned: number;
  readonly group_bonus_earned: boolean;
  readonly completion_bonus_earned: boolean;
}

interface RawHistorySessionRow {
  readonly id: string;
  readonly type: SessionRowType;
  readonly started_at: string | null;
  readonly ended_at: string;
  // PostgREST always embeds a to-many relationship as an array, even when
  // the query's own .eq('session_participants.user_id', ...) filter
  // guarantees exactly one match per session (the (session_id, user_id)
  // unique constraint) — normalized to a flat row below so callers never
  // need to know that.
  readonly session_participants: readonly RawHistoryParticipant[];
}

const HISTORY_COLUMNS =
  'id, type, started_at, ended_at, session_participants!inner(exit_reason, total_minutes_present, points_earned, group_bonus_earned, completion_bonus_earned)';

// Keyset pagination (not OFFSET): `cursor` is the ended_at of the last row
// from the previous page, and the next page asks for strictly older rows.
// Stays fast at any history size, unlike OFFSET which re-scans every
// skipped row on each page. Omit `cursor` for the first page.
export const fetchSessionHistory = async (
  userId: string,
  filter: HistoryFilter,
  cursor?: string,
): Promise<RepositoryResult<readonly SessionHistoryRow[]>> => {
  let query = getSupabaseClient()
    .from('sessions')
    .select(HISTORY_COLUMNS)
    .eq('session_participants.user_id', userId)
    .not('ended_at', 'is', null);

  if (filter === 'solo') {
    query = query.eq('type', 'solo');
  } else if (filter === 'group') {
    query = query.in('type', ['dynamic_qr', 'static_qr']);
  }
  if (cursor !== undefined) {
    query = query.lt('ended_at', cursor);
  }

  const { data, error } = await query
    .order('ended_at', { ascending: false })
    .limit(HISTORY_PAGE_SIZE);

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }

  const rows = (data ?? []) as unknown as readonly RawHistorySessionRow[];
  const mapped: SessionHistoryRow[] = [];
  for (const row of rows) {
    const participant = row.session_participants[0];
    // Defensive only: the !inner join + eq filter above guarantee this,
    // but noUncheckedIndexedAccess-style discipline means the type says
    // it could be undefined, so it's handled rather than asserted away.
    if (participant === undefined) {
      continue;
    }
    mapped.push({
      id: row.id,
      type: row.type,
      started_at: row.started_at,
      ended_at: row.ended_at,
      exit_reason: participant.exit_reason,
      total_minutes_present: participant.total_minutes_present,
      points_earned: participant.points_earned,
      group_bonus_earned: participant.group_bonus_earned,
      completion_bonus_earned: participant.completion_bonus_earned,
    });
  }
  return { ok: true, value: mapped };
};
