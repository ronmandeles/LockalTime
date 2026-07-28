-- pgTAP test for Phase 5's schema additions: user_streaks, user_stats,
-- user_stats_daily, milestones, user_milestones, plus users.timezone and
-- session_participants.stats_applied_at. Shape per docs/DATABASE.md, with
-- three deliberate deviations documented in backlog.md task 5.2 (see
-- migration file header). This file tests SHAPE + RLS + grants only --
-- apply_session_stats()'s streak/milestone logic is a separate contract,
-- supabase/tests/apply_session_stats_test.sql (Phase 5 task 3).
-- Run with: supabase test db

begin;
select plan(28);

-- ── Schema shape ────────────────────────────────────────────────────
select has_table('public', 'user_streaks', 'public.user_streaks table exists');
select has_table('public', 'user_stats', 'public.user_stats table exists');
select has_table('public', 'user_stats_daily', 'public.user_stats_daily table exists');
select has_table('public', 'milestones', 'public.milestones table exists');
select has_table('public', 'user_milestones', 'public.user_milestones table exists');

select has_column('public', 'users', 'timezone', 'users gains timezone');
select has_column(
  'public', 'session_participants', 'stats_applied_at',
  'session_participants gains stats_applied_at (apply_session_stats idempotency key)'
);
select has_column(
  'public', 'user_stats', 'sessions_disconnected',
  'user_stats gains sessions_disconnected (deviation: disconnected exits need their own counter)'
);
select has_column(
  'public', 'user_streaks', 'last_session_day',
  'user_streaks gains last_session_day (deviation: streak advances on a local-day boundary)'
);
select has_column(
  'public', 'milestones', 'slug',
  'milestones gains slug (deviation: an i18n key, since name is a DB string)'
);

select is(
  (select relrowsecurity from pg_class where oid = 'public.user_streaks'::regclass),
  true, 'RLS enabled on public.user_streaks'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.user_stats'::regclass),
  true, 'RLS enabled on public.user_stats'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.user_stats_daily'::regclass),
  true, 'RLS enabled on public.user_stats_daily'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.user_milestones'::regclass),
  true, 'RLS enabled on public.user_milestones'
);

-- ── Milestone seed ladder ───────────────────────────────────────────
select is(
  (select count(*)::int from public.milestones), 6, 'six milestones seeded'
);
select is(
  (select array_agg(sessions_required order by sessions_required) from public.milestones),
  array[5, 10, 25, 50, 100, 250], 'milestone thresholds are 5/10/25/50/100/250 sessions'
);
select is(
  (select count(distinct slug)::int from public.milestones), 6, 'every milestone slug is unique'
);

-- ── Fixtures ────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('11111111-1111-1111-1111-111111111111', 'stats-owner@test.dev'),
  ('22222222-2222-2222-2222-222222222222', 'stats-other@test.dev');

insert into public.user_stats (user_id, total_minutes, total_points, sessions_completed) values
  ('11111111-1111-1111-1111-111111111111', 90, 90, 3),
  ('22222222-2222-2222-2222-222222222222', 30, 30, 1);

insert into public.user_stats_daily (user_id, day, minutes, points, sessions) values
  ('11111111-1111-1111-1111-111111111111', current_date, 30, 30, 1),
  ('22222222-2222-2222-2222-222222222222', current_date, 30, 30, 1);

insert into public.user_streaks (user_id, current_streak, longest_streak) values
  ('11111111-1111-1111-1111-111111111111', 2, 5),
  ('22222222-2222-2222-2222-222222222222', 1, 1);

insert into public.user_milestones (user_id, milestone_id)
  select '11111111-1111-1111-1111-111111111111', id from public.milestones
  where slug = 'sessions_5';

-- ── RLS: own rows only ──────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

select is(
  (select count(*)::int from public.user_stats),
  1, 'a user reading user_stats only sees their own row'
);
select is(
  (select count(*)::int from public.user_stats_daily),
  1, 'a user reading user_stats_daily only sees their own rows'
);
select is(
  (select count(*)::int from public.user_streaks),
  1, 'a user reading user_streaks only sees their own row'
);
select is(
  (select count(*)::int from public.user_milestones),
  1, 'a user reading user_milestones only sees their own rows'
);
select is(
  (select count(*)::int from public.milestones),
  6, 'milestones is global reference data -- every authenticated user sees all rows'
);

-- ── Grants: client cannot write money-equivalent-adjacent stats directly ──
select throws_ok(
  $$ update public.user_stats set total_points = 999999
       where user_id = '11111111-1111-1111-1111-111111111111' $$,
  NULL,
  'authenticated cannot update user_stats directly (apply_session_stats-only)'
);
select throws_ok(
  $$ update public.user_streaks set current_streak = 999
       where user_id = '11111111-1111-1111-1111-111111111111' $$,
  NULL,
  'authenticated cannot update user_streaks directly (apply_session_stats-only)'
);
select throws_ok(
  $$ insert into public.user_milestones (user_id, milestone_id)
       select '11111111-1111-1111-1111-111111111111', id from public.milestones
       where slug = 'sessions_10' $$,
  NULL,
  'authenticated cannot insert user_milestones directly (apply_session_stats-only)'
);
select throws_ok(
  $$ insert into public.milestones (slug, name, sessions_required, bonus_points)
       values ('bogus', 'Bogus', 1, 1) $$,
  NULL,
  'authenticated cannot write milestones (fixed product config, migration-only)'
);

-- ── users.timezone: user-editable, same posture as display_name ───────
select lives_ok(
  $$ update public.users set timezone = 'Asia/Jerusalem'
       where id = '11111111-1111-1111-1111-111111111111' $$,
  'a user can set their own timezone'
);
select throws_ok(
  $$ update public.users set role = 'admin'
       where id = '11111111-1111-1111-1111-111111111111' $$,
  NULL,
  'timezone being editable does not reopen role (column-scoped grant unchanged)'
);

select * from finish();
rollback;
