-- pgTAP test for the Phase 2 core session schema: sessions,
-- session_host_assignments, session_presence_intervals, session_participants,
-- device_attestations, and the is_session_participant() RLS helper.
-- Run with: supabase test db

begin;
select plan(22);

-- ── Schema shape ────────────────────────────────────────────────────
select has_table('public', 'sessions', 'public.sessions table exists');
select has_table('public', 'session_host_assignments', 'public.session_host_assignments table exists');
select has_table('public', 'session_presence_intervals', 'public.session_presence_intervals table exists');
select has_table('public', 'session_participants', 'public.session_participants table exists');
select has_table('public', 'device_attestations', 'public.device_attestations table exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.sessions'::regclass),
  true, 'RLS enabled on public.sessions'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.session_presence_intervals'::regclass),
  true, 'RLS enabled on public.session_presence_intervals'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.session_participants'::regclass),
  true, 'RLS enabled on public.session_participants'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.device_attestations'::regclass),
  true, 'RLS enabled on public.device_attestations'
);

-- ── CHECK constraints (as service role — bypasses RLS, exercises CHECKs) ──
insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'host@test.dev'),
  ('66666666-6666-6666-6666-666666666666', 'participant@test.dev');

select throws_ok(
  $$ insert into public.sessions (host_id, type, duration_mode, planned_duration_minutes)
       values ('55555555-5555-5555-5555-555555555555', 'solo', 'fixed', null) $$,
  NULL,
  'fixed duration_mode with a null planned_duration_minutes is rejected'
);

select throws_ok(
  $$ insert into public.sessions (host_id, type, duration_mode, planned_duration_minutes)
       values ('55555555-5555-5555-5555-555555555555', 'dynamic_qr', 'fixed', 30) $$,
  NULL,
  'dynamic_qr with a null qr_token is rejected'
);

select lives_ok(
  $$ insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes)
       values ('77777777-7777-7777-7777-777777777777',
               '55555555-5555-5555-5555-555555555555', 'solo', 'fixed', 30) $$,
  'a valid solo/fixed session insert succeeds'
);

insert into public.session_host_assignments (session_id, user_id, reason) values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', 'initial_host');

-- ── Read policies: host counts as a participant even with no presence row ──
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select is(
  (select count(*) from public.sessions where id = '77777777-7777-7777-7777-777777777777')::int,
  1, 'the host can read their own session with no presence interval yet'
);
select is(
  (select count(*) from public.session_host_assignments
     where session_id = '77777777-7777-7777-7777-777777777777')::int,
  1, 'the host can read the session''s host-assignment audit row'
);

-- ── Non-participant cannot read ─────────────────────────────────────
reset role;
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select is(
  (select count(*) from public.sessions where id = '77777777-7777-7777-7777-777777777777')::int,
  0, 'a non-participant cannot read the session'
);
select is(
  (select count(*) from public.session_host_assignments
     where session_id = '77777777-7777-7777-7777-777777777777')::int,
  0, 'a non-participant cannot read the host-assignment audit row'
);

-- ── Once joined (a presence interval exists), the participant can read ──
reset role;
insert into public.session_presence_intervals (session_id, user_id) values
  ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666');
insert into public.session_participants (session_id, user_id, is_host) values
  ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555', true),
  ('77777777-7777-7777-7777-777777777777', '66666666-6666-6666-6666-666666666666', false);

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"66666666-6666-6666-6666-666666666666","role":"authenticated"}';

select is(
  (select count(*) from public.session_presence_intervals
     where session_id = '77777777-7777-7777-7777-777777777777')::int,
  1, 'a joined participant can read all presence intervals for the session'
);
select is(
  (select count(*) from public.session_participants
     where session_id = '77777777-7777-7777-7777-777777777777')::int,
  2, 'a joined participant can read all session_participants rows for the session'
);

-- ── device_attestations: Node-internal only, no client read path at all ──
reset role;
insert into public.device_attestations (user_id, session_id, platform, action, verdict, raw_response)
  values ('55555555-5555-5555-5555-555555555555', '77777777-7777-7777-7777-777777777777',
          'android', 'create', 'MEETS_DEVICE_INTEGRITY', '{}'::jsonb);

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select throws_ok(
  $$ select * from public.device_attestations $$,
  NULL,
  'authenticated cannot read device_attestations at all (no grant — Node/service-role only)'
);

-- ── No direct writes from authenticated (grant, not just policy) ──────
select throws_ok(
  $$ insert into public.sessions (host_id, type, duration_mode, planned_duration_minutes)
       values ('55555555-5555-5555-5555-555555555555', 'solo', 'fixed', 10) $$,
  NULL,
  'authenticated cannot insert a session directly (no grant — API-only)'
);
select throws_ok(
  $$ insert into public.session_presence_intervals (session_id, user_id)
       values ('77777777-7777-7777-7777-777777777777', '55555555-5555-5555-5555-555555555555') $$,
  NULL,
  'authenticated cannot insert a presence interval directly (no grant — API-only)'
);

-- ── is_session_participant() is queryable directly and matches the read policies ──
select is(
  public.is_session_participant('77777777-7777-7777-7777-777777777777'),
  true, 'is_session_participant() is true for the current joined user'
);

select * from finish();
rollback;
