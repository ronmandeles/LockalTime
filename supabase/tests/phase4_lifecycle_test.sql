-- pgTAP test for Phase 4's schema additions: sessions.end_reason gains
-- 'force_terminated', session_participants.exit_reason gains 'disconnected',
-- session_presence_intervals gains blocker_ready_at, and the new
-- rewards_history table + its RLS policy.
-- Run with: supabase test db

begin;
select plan(11);

-- ── Schema shape ────────────────────────────────────────────────────
select has_table('public', 'rewards_history', 'public.rewards_history table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.rewards_history'::regclass),
  true, 'RLS enabled on public.rewards_history'
);
select has_column(
  'public', 'session_presence_intervals', 'blocker_ready_at',
  'session_presence_intervals gains blocker_ready_at'
);

-- ── Fixtures ────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'host@test.dev'),
  ('66666666-6666-6666-6666-666666666666', 'other@test.dev');

insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes)
  values ('77777777-7777-7777-7777-777777777777',
          '55555555-5555-5555-5555-555555555555', 'solo', 'fixed', 30);
insert into public.session_host_assignments (session_id, user_id, reason) values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'initial_host');

-- ── end_reason CHECK ────────────────────────────────────────────────
select lives_ok(
  $$ update public.sessions set status = 'completed', end_reason = 'force_terminated',
       ended_at = now() where id = '77777777-7777-7777-7777-777777777777' $$,
  'force_terminated is now a valid end_reason'
);
select throws_ok(
  $$ update public.sessions set end_reason = 'bogus_reason'
       where id = '77777777-7777-7777-7777-777777777777' $$,
  NULL,
  'an unrecognized end_reason is still rejected'
);

-- ── exit_reason CHECK ───────────────────────────────────────────────
select lives_ok(
  $$ insert into public.session_participants
       (session_id, user_id, is_host, total_minutes_present, exit_reason, points_earned)
       values ('77777777-7777-7777-7777-777777777777',
               '66666666-6666-6666-6666-666666666666', false, 12, 'disconnected', 12) $$,
  'disconnected is now a valid exit_reason'
);
select throws_ok(
  $$ insert into public.session_participants
       (session_id, user_id, is_host, total_minutes_present, exit_reason, points_earned)
       values ('77777777-7777-7777-7777-777777777777',
               '55555555-5555-5555-5555-555555555555', true, 12, 'bogus_reason', 12) $$,
  NULL,
  'an unrecognized exit_reason is still rejected'
);

-- ── blocker_ready_at is nullable and independently settable ───────────
insert into public.session_presence_intervals (session_id, user_id, joined_at, left_at)
  values ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555',
          now(), now());
select lives_ok(
  $$ update public.session_presence_intervals set blocker_ready_at = now()
       where session_id = '77777777-7777-7777-7777-777777777777'
       and user_id = '55555555-5555-5555-5555-555555555555' $$,
  'blocker_ready_at can be set after the fact'
);

-- ── rewards_history RLS: own rows only ─────────────────────────────
insert into public.rewards_history (user_id, session_id, points, bonus_type) values
  ('55555555-5555-5555-5555-555555555555', '77777777-7777-7777-7777-777777777777', 12, 'base'),
  ('66666666-6666-6666-6666-666666666666', '77777777-7777-7777-7777-777777777777', 12, 'base');

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select is(
  (select count(*) from public.rewards_history)::int,
  1, 'a user reading rewards_history only sees their own rows'
);
select is(
  (select points from public.rewards_history
     where user_id = '55555555-5555-5555-5555-555555555555')::int,
  12, 'the visible row is the user''s own reward'
);

select throws_ok(
  $$ insert into public.rewards_history (user_id, session_id, points, bonus_type)
       values ('55555555-5555-5555-5555-555555555555',
               '77777777-7777-7777-7777-777777777777', 999, 'base') $$,
  NULL,
  'authenticated cannot insert into rewards_history directly (API-only)'
);

select * from finish();
rollback;
