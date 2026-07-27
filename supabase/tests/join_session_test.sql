-- pgTAP test for public.join_session(), the atomic join RPC.
-- Concurrency itself (two simultaneous callers racing the same capacity
-- slot) isn't testable in a single pgTAP transaction — that's covered by
-- apps/server's integration test issuing real concurrent requests against
-- the running local stack. This file covers the function's branches.
-- Run with: supabase test db

begin;
select plan(7);

insert into auth.users (id, email) values
  ('88888888-8888-8888-8888-888888888888', 'join-host@test.dev'),
  ('99999999-9999-9999-9999-999999999999', 'join-participant@test.dev');

-- A real dynamic_qr session with a signed-looking token (the function
-- never re-verifies the HMAC signature itself — Node already did that
-- before calling it — it only compares the token string against the
-- session's current qr_token column, which is what makes a regenerated
-- token stop working even though its signature is still "valid").
insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes, qr_token, qr_expires_at)
  values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888',
          'dynamic_qr', 'fixed', 30, 'current-token', now() + interval '15 minutes');

insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes, qr_token, qr_expires_at, status)
  values ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '88888888-8888-8888-8888-888888888888',
          'dynamic_qr', 'fixed', 30, 'cancelled-token', now() + interval '15 minutes', 'cancelled');

insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes, qr_token, qr_expires_at)
  values ('cccccccc-cccc-cccc-cccc-cccccccccccc', '88888888-8888-8888-8888-888888888888',
          'dynamic_qr', 'fixed', 30, 'expired-token', now() - interval '1 minute');

select is(
  public.join_session('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
                       'irrelevant-token', 50),
  'not_found', 'joining a session that does not exist returns not_found'
);

select is(
  public.join_session('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '99999999-9999-9999-9999-999999999999',
                       'cancelled-token', 50),
  'not_joinable', 'joining a cancelled session returns not_joinable'
);

select is(
  public.join_session('cccccccc-cccc-cccc-cccc-cccccccccccc', '99999999-9999-9999-9999-999999999999',
                       'expired-token', 50),
  'expired', 'joining with an expired qr_expires_at returns expired'
);

select is(
  public.join_session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999',
                       'a-stale-regenerated-token', 50),
  'invalid_token', 'a token that no longer matches the session''s current qr_token returns invalid_token'
);

select is(
  public.join_session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999',
                       'current-token', 1),
  'joined', 'a valid first join returns joined'
);

select is(
  public.join_session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '99999999-9999-9999-9999-999999999999',
                       'current-token', 1),
  'already_joined', 'rejoining while already open is idempotent, not an error'
);

select is(
  public.join_session('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', '88888888-8888-8888-8888-888888888888',
                       'current-token', 1),
  'at_capacity', 'a second distinct user is rejected once the max_participants slot is full'
);

select * from finish();
rollback;
