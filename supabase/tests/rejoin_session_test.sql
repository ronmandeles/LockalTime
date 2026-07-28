-- pgTAP test for public.rejoin_session(), the token-free re-entry RPC.
-- Concurrency itself is covered by apps/server's integration test issuing
-- real concurrent requests against the running local stack, same as
-- join_session_test.sql. This file covers the function's branches.
-- Run with: supabase test db

begin;
select plan(6);

insert into auth.users (id, email) values
  ('11111111-2222-3333-4444-555555555555', 'rejoin-host@test.dev'),
  ('66666666-7777-8888-9999-000000000000', 'rejoin-participant@test.dev'),
  ('12121212-1212-1212-1212-121212121212', 'rejoin-stranger@test.dev');

insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes, qr_token, status)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-2222-3333-4444-555555555555',
          'dynamic_qr', 'fixed', 30, 'rejoin-active-token', 'active');

insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes, qr_token, status)
  values ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-2222-3333-4444-555555555555',
          'dynamic_qr', 'fixed', 30, 'rejoin-completed-token', 'completed');

-- The participant's prior visit to the active session: joined once, then
-- left (closed interval) — this is exactly the "was here, then dropped"
-- shape rejoin exists to re-open.
insert into public.session_presence_intervals (session_id, user_id, joined_at, left_at, disconnect_reason)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-7777-8888-9999-000000000000',
          now() - interval '20 minutes', now() - interval '10 minutes', 'involuntary_disconnect');

select is(
  public.rejoin_session('00000000-0000-0000-0000-000000000000', '66666666-7777-8888-9999-000000000000', 50),
  'not_found', 'rejoining a session that does not exist returns not_found'
);

select is(
  public.rejoin_session('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '66666666-7777-8888-9999-000000000000', 50),
  'not_joinable', 'rejoining a completed session returns not_joinable'
);

select is(
  public.rejoin_session('dddddddd-dddd-dddd-dddd-dddddddddddd', '12121212-1212-1212-1212-121212121212', 50),
  'not_a_participant', 'a user with no prior presence interval for this session cannot rejoin'
);

select is(
  public.rejoin_session('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-7777-8888-9999-000000000000', 50),
  'joined', 'a prior participant with a closed interval can rejoin'
);

select is(
  public.rejoin_session('dddddddd-dddd-dddd-dddd-dddddddddddd', '66666666-7777-8888-9999-000000000000', 50),
  'already_joined', 'rejoining again while already open is idempotent, not an error'
);

-- The stranger did participate once too (a closed interval, satisfying
-- "ever participated"), but the participant's rejoin above (test 4) left
-- the session's one open slot occupied — with max_participants=1, capacity
-- is checked against ALL open intervals in the session, not just this
-- user's own, matching join_session()'s semantics.
insert into public.session_presence_intervals (session_id, user_id, joined_at, left_at, disconnect_reason)
  values ('dddddddd-dddd-dddd-dddd-dddddddddddd', '12121212-1212-1212-1212-121212121212',
          now() - interval '5 minutes', now() - interval '1 minute', 'involuntary_disconnect');

select is(
  public.rejoin_session('dddddddd-dddd-dddd-dddd-dddddddddddd', '12121212-1212-1212-1212-121212121212', 1),
  'at_capacity', 'a former participant is still rejected once the max_participants slot is full'
);

select * from finish();
rollback;
