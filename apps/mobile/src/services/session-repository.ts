import { getSupabaseClient } from './supabase-client';

// Direct, RLS-protected Supabase reads for session hydration — not the
// Node API. Session shape/status/presence are structural state, not
// money-equivalent (.claude/skills/supabase-integration/SKILL.md); the
// is_session_participant() read policies (Phase 2 task 2.1) exist
// specifically to authorize this. "REST hydrate" in ARCHITECTURE.md §5
// means PostgREST via supabase-js — the same transport CDC resumes from,
// so a reconnecting client and a freshly-mounted one hydrate identically.

export type SessionRowType = 'solo' | 'dynamic_qr' | 'static_qr';
export type SessionRowStatus = 'pending' | 'active' | 'completed' | 'cancelled';
export type SessionRowDurationMode = 'fixed' | 'open_ended';

export interface SessionRow {
  readonly id: string;
  readonly host_id: string;
  readonly venue_id: string | null;
  readonly type: SessionRowType;
  readonly status: SessionRowStatus;
  readonly duration_mode: SessionRowDurationMode;
  readonly planned_duration_minutes: number | null;
  readonly started_at: string | null;
  readonly ended_at: string | null;
  readonly created_at: string;
}

export interface PresenceIntervalRow {
  readonly id: string;
  readonly session_id: string;
  readonly user_id: string;
  readonly joined_at: string;
  readonly left_at: string | null;
}

export interface RepositoryFailure {
  readonly message: string;
}

export type RepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: RepositoryFailure };

const SESSION_COLUMNS =
  'id, host_id, venue_id, type, status, duration_mode, planned_duration_minutes, started_at, ended_at, created_at';

export const fetchSession = async (sessionId: string): Promise<RepositoryResult<SessionRow>> => {
  const { data, error } = await getSupabaseClient()
    .from('sessions')
    .select(SESSION_COLUMNS)
    .eq('id', sessionId)
    .single();

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: data as unknown as SessionRow };
};

// Open intervals (left_at is null) are the live "who's currently in the
// session" list — session_participants is a different table, only
// populated once at session close (DATABASE.md design note), not a live
// roster.
export const fetchOpenPresenceIntervals = async (
  sessionId: string,
): Promise<RepositoryResult<readonly PresenceIntervalRow[]>> => {
  const { data, error } = await getSupabaseClient()
    .from('session_presence_intervals')
    .select('id, session_id, user_id, joined_at, left_at')
    .eq('session_id', sessionId)
    .is('left_at', null)
    .order('joined_at');

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: data as unknown as readonly PresenceIntervalRow[] };
};
