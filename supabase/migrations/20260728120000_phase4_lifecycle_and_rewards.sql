-- Phase 4 (Session Lifecycle Logic) schema additions. Test-first contract:
-- supabase/tests/phase4_lifecycle_test.sql. Shape/rationale per
-- docs/DATABASE.md's "Bonus Computation" section and ARCHITECTURE.md §6/§7,
-- decided during Phase 4 planning (see backlog.md).

-- ============================================================
-- sessions.end_reason: add 'force_terminated' for the open-ended 24h
-- lifetime cap (ARCHITECTURE.md §6) — distinct from 'planned_duration_reached'
-- (which now covers BOTH a host-triggered end AND the fixed-duration
-- auto-close job, since both mean "the planned duration was reached").
-- Still non-punitive: status stays 'completed', only end_reason
-- distinguishes why.
-- ============================================================
alter table public.sessions
  drop constraint sessions_end_reason_check;
alter table public.sessions
  add constraint sessions_end_reason_check
  check (end_reason in ('host_ended', 'planned_duration_reached', 'force_terminated'));

-- ============================================================
-- session_participants.exit_reason: add 'disconnected' for a participant
-- who went offline and never reconnected before the session ended --
-- distinct from 'emergency_exit' (their own choice) and 'completed'
-- (present at the end). Same forfeit-both-bonuses treatment as
-- emergency_exit, tracked separately for history/analytics.
-- ============================================================
alter table public.session_participants
  drop constraint session_participants_exit_reason_check;
alter table public.session_participants
  add constraint session_participants_exit_reason_check
  check (exit_reason in ('completed', 'emergency_exit', 'disconnected'));

-- ============================================================
-- session_presence_intervals.blocker_ready_at: set once the participant's
-- device confirms the native blocker actually started (not merely tapped
-- "join") -- ARCHITECTURE.md §7's Sybil-resistance gate for the Group
-- Bonus's 5+ concurrent-count threshold. Null means never confirmed: the
-- interval still counts for base points, but never toward that threshold
-- (see apps/server/src/modules/points/group-bonus.ts).
-- ============================================================
alter table public.session_presence_intervals
  add column blocker_ready_at timestamptz;

-- ============================================================
-- REWARDS HISTORY (audit trail for every point-granting event, DATABASE.md)
-- ============================================================
create table public.rewards_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id),
  session_id uuid references public.sessions(id),
  points     int not null,
  bonus_type text not null
               check (bonus_type in ('base', 'group_bonus', 'completion_bonus', 'milestone')),
  created_at timestamptz not null default now()
);

create index idx_rewards_user_time on public.rewards_history(user_id, created_at desc);

alter table public.rewards_history enable row level security;

-- Own rows only -- this is a per-user receipt, not shared session data, so
-- it doesn't reuse is_session_participant() the way sessions/session_*
-- tables do.
create policy "users can read their own rewards history"
  on public.rewards_history for select
  using (user_id = auth.uid());

grant select on public.rewards_history to authenticated;
-- service_role needs an explicit grant too, same reason as every other
-- table the Node API writes to (supabase-integration skill) -- new tables
-- get zero Data API privileges by default, service_role included.
grant select, insert on public.rewards_history to service_role;

-- blocker_ready_at is written by the Node API only (the client reports
-- readiness through a Node endpoint, never a direct client update) -- no
-- new grant needed beyond session_presence_intervals' existing
-- `grant ... update ... to service_role`.
