-- Phase 5 (Gamification & Stats) schema additions. Test-first contract:
-- supabase/tests/phase5_gamification_test.sql. Shape per docs/DATABASE.md's
-- user_streaks/user_stats/user_stats_daily/milestones/user_milestones
-- tables, decided during Phase 4 planning -- with three deviations decided
-- during Phase 5 planning (see backlog.md task 5.2):
--   1. user_stats.sessions_disconnected -- DATABASE.md only tracked
--      sessions_completed/sessions_emergency_exit; a 'disconnected'
--      exit_reason (Phase 4) counted toward neither, so the three counters
--      didn't sum to the session count.
--   2. user_streaks.last_session_day -- the streak advances on a
--      *local-day* boundary (users.timezone below), so the resolved local
--      day is stored rather than re-derived from last_session_at on every
--      comparison.
--   3. milestones.slug -- milestones.name is a DB string, which would be
--      an untranslatable hardcoded UI string (i18n skill). slug is the
--      i18n key instead; name is kept only as a migration-authoring aid.

-- ============================================================
-- USERS: timezone (Phase 5) -- an IANA zone name (e.g. "Asia/Jerusalem"),
-- reported by the client (react-native-localize's getTimeZone()) so the
-- server can bucket a session into the participant's LOCAL day rather than
-- UTC -- see apply_session_stats() (Phase 5 task 3). Display/bucketing
-- data, not money-equivalent, so a direct client write is appropriate --
-- same posture as display_name/avatar_url. Extends the existing
-- column-scoped grant (a table-wide grant would reopen `role`, per the
-- supabase-integration skill's column-vs-table-grant note).
-- ============================================================
alter table public.users add column timezone text;
revoke update on public.users from authenticated;
grant update (display_name, avatar_url, timezone) on public.users to authenticated;

-- ============================================================
-- SESSION_PARTICIPANTS: stats_applied_at (Phase 5) -- the exactly-once
-- idempotency key apply_session_stats() (task 5.3) checks before
-- accumulating this participant's row into user_stats/user_stats_daily/
-- user_streaks/user_milestones. Null = not yet applied. Node-only write
-- (inside the SECURITY DEFINER function), same posture as every other
-- session_participants column.
-- ============================================================
alter table public.session_participants add column stats_applied_at timestamptz;

-- ============================================================
-- USER STREAKS (docs/DATABASE.md) -- one row per user, lazily created by
-- apply_session_stats() on a user's first-ever contributing session.
-- ============================================================
create table public.user_streaks (
  user_id                 uuid primary key references public.users(id) on delete cascade,
  current_streak          int not null default 0,
  longest_streak          int not null default 0,
  last_session_at         timestamptz,
  last_session_day        date,          -- deviation 2 above
  streak_grace_expires_at timestamptz    -- last_session_at + STREAK_GRACE_HOURS
);

-- ============================================================
-- USER STATS (docs/DATABASE.md) -- lifetime aggregates, Home screen
-- summary + Stats screen. Invariant this schema exists to make provable:
-- total_points always equals sum(rewards_history.points) for that user
-- (Phase 5 DoD) -- enforced by apply_session_stats() writing both inside
-- the same transaction, never independently.
-- ============================================================
create table public.user_stats (
  user_id                 uuid primary key references public.users(id) on delete cascade,
  total_minutes           int not null default 0,
  total_points            int not null default 0,
  sessions_completed      int not null default 0,
  sessions_emergency_exit int not null default 0,
  sessions_disconnected   int not null default 0,  -- deviation 1 above
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- USER STATS DAILY (docs/DATABASE.md) -- time series backing the Stats
-- screen's 7-day chart. `day` is the participant's LOCAL date (see
-- users.timezone above), not UTC -- a session ending 01:00 local time
-- must land on that local day's bar, not the day the UTC clock was on.
-- ============================================================
create table public.user_stats_daily (
  user_id  uuid not null references public.users(id) on delete cascade,
  day      date not null,
  minutes  int not null default 0,
  points   int not null default 0,
  sessions int not null default 0,
  primary key (user_id, day)
);

-- ============================================================
-- MILESTONES (docs/DATABASE.md) -- global, periodic, not per-session
-- (ARCHITECTURE.md §9). Fixed product config seeded by this migration, not
-- user data -- session-count based, six tiers, decided during Phase 5
-- planning (docs/RETENTION_STRATEGY.md §2). `slug` is the i18n key
-- (t('milestones.' + slug)); `name` is kept only as an English fallback/
-- migration-authoring aid, never rendered directly (no-hardcoded-strings
-- rule, i18n skill).
-- ============================================================
create table public.milestones (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,
  name              text not null,
  sessions_required int not null,
  bonus_points      int not null
);

insert into public.milestones (slug, name, sessions_required, bonus_points) values
  ('sessions_5',   'First Five',      5,   50),
  ('sessions_10',  'Ten Sessions',    10,  100),
  ('sessions_25',  'Quarter Century', 25,  250),
  ('sessions_50',  'Half Century',    50,  500),
  ('sessions_100', 'Centurion',       100, 1000),
  ('sessions_250', 'Dedicated',       250, 2500);

-- ============================================================
-- USER MILESTONES (docs/DATABASE.md) -- crossing record. Written by
-- apply_session_stats() via `insert ... on conflict do nothing`, which is
-- what makes crossing detection naturally idempotent and lets a single
-- session cross more than one threshold at once.
-- ============================================================
create table public.user_milestones (
  user_id      uuid not null references public.users(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id),
  achieved_at  timestamptz not null default now(),
  primary key (user_id, milestone_id)
);

alter table public.user_streaks enable row level security;
alter table public.user_stats enable row level security;
alter table public.user_stats_daily enable row level security;
alter table public.milestones enable row level security;
alter table public.user_milestones enable row level security;

-- Own rows only -- per-user receipts, same reasoning as rewards_history
-- (not is_session_participant(), which is for shared session data).
create policy "users can read their own streak"
  on public.user_streaks for select
  using (user_id = auth.uid());
create policy "users can read their own stats"
  on public.user_stats for select
  using (user_id = auth.uid());
create policy "users can read their own daily stats"
  on public.user_stats_daily for select
  using (user_id = auth.uid());
create policy "users can read their own milestone crossings"
  on public.user_milestones for select
  using (user_id = auth.uid());

-- milestones is global reference data (the ladder itself, not a user's
-- progress on it) -- every authenticated user reads every row.
create policy "authenticated can read all milestones"
  on public.milestones for select
  using (true);

grant select on public.user_streaks to authenticated;
grant select on public.user_stats to authenticated;
grant select on public.user_stats_daily to authenticated;
grant select on public.user_milestones to authenticated;
grant select on public.milestones to authenticated;

-- service_role grants. apply_session_stats() (task 5.3) is SECURITY
-- DEFINER, so its own WRITES run as the function owner and need no grant
-- here for that (same reasoning as join_session()/rejoin_session()) --
-- but service_role still needs its own SELECT to read these tables back
-- through the Data API at all (service_role bypasses RLS POLICIES, not
-- GRANTS — the Phase 2 lesson, supabase-integration skill), which every
-- integration test and any future admin/debug tooling needs. user_streaks
-- additionally gets UPDATE: the Phase 5 task 5 streak-expiry job issues a
-- plain service-role UPDATE directly (there's nothing atomicity-sensitive
-- about zeroing an already-expired streak, so it doesn't need its own
-- SECURITY DEFINER function).
grant select, update on public.user_streaks to service_role;
grant select on public.user_stats to service_role;
grant select on public.user_stats_daily to service_role;
grant select on public.user_milestones to service_role;
grant select on public.milestones to service_role;
