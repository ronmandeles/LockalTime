-- pgTAP test for public.join_venue_session(), the venue-scoped join RPC
-- (Phase 6 task 2). Concurrency itself isn't testable in a single pgTAP
-- transaction — covered by apps/server's integration suite. This file
-- covers the function's branches, plus the partial unique index and the
-- static_qr-requires-venue CHECK it depends on.
-- Run with: supabase test db

begin;
select plan(11);

insert into auth.users (id, email) values
  ('11111111-2222-3333-4444-555555555555', 'venue-owner-2@test.dev'),
  ('66666666-6666-6666-6666-666666666666', 'venue-joiner@test.dev'),
  ('77777777-6666-6666-6666-666666666666', 'venue-joiner-2@test.dev');

insert into public.venues (id, owner_id, name, qr_token) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', '11111111-2222-3333-4444-555555555555',
   'Venue With No Session', 'venue-token-a'),
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', '11111111-2222-3333-4444-555555555555',
   'Venue With An Active Session', 'venue-token-b');

-- The venue's currently-active static_qr session. status must be set
-- explicitly to 'active' -- it defaults to 'pending', and unlike
-- join_session() (which accepts pending OR active), join_venue_session()
-- requires active specifically, matching the real create-session.ts flow
-- where a session is always active immediately at creation (Phase 4
-- decision) -- pending is never reachable in practice.
insert into public.sessions (id, host_id, venue_id, type, duration_mode, qr_token, status)
  values ('ffffffff-ffff-ffff-ffff-ffffffffffff', '11111111-2222-3333-4444-555555555555',
          'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'static_qr', 'open_ended',
          'session-token-for-static-qr', 'active');

select is(
  (select outcome from public.join_venue_session(
    '00000000-0000-0000-0000-000000000000', 'irrelevant-token',
    '66666666-6666-6666-6666-666666666666', 50)),
  'venue_not_found', 'a venue id that does not exist returns venue_not_found'
);

select is(
  (select outcome from public.join_venue_session(
    'dddddddd-dddd-dddd-dddd-dddddddddddd', 'venue-token-a',
    '66666666-6666-6666-6666-666666666666', 50)),
  'no_active_session', 'a real venue with no currently-active static_qr session returns no_active_session'
);

select is(
  (select outcome from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'a-stale-regenerated-venue-token',
    '66666666-6666-6666-6666-666666666666', 50)),
  'invalid_token', 'a token that no longer matches the venue''s current qr_token returns invalid_token'
);

select is(
  (select outcome from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'venue-token-b',
    '66666666-6666-6666-6666-666666666666', 1)),
  'joined', 'a valid first join resolves the venue''s active session and returns joined'
);

select is(
  (select session_id from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'venue-token-b',
    '77777777-6666-6666-6666-666666666666', 1)),
  'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
  'the resolved session_id is the venue''s active static_qr session, even on a rejected join'
);

select is(
  (select outcome from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'venue-token-b',
    '77777777-6666-6666-6666-666666666666', 1)),
  'at_capacity', 'a second distinct user is rejected once max_participants=1 is full'
);

select is(
  (select outcome from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'venue-token-b',
    '66666666-6666-6666-6666-666666666666', 1)),
  'already_joined', 'rejoining while already open is idempotent, not an error'
);

-- ── regeneration invalidates the old printed code ───────────────────
update public.venues set qr_token = 'venue-token-b-regenerated'
  where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee';

select is(
  (select outcome from public.join_venue_session(
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'venue-token-b',
    '77777777-6666-6666-6666-666666666666', 50)),
  'invalid_token', 'the OLD venue token stops working the instant the venue''s qr_token is regenerated'
);

-- ── static_qr requires venue_id (chk_static_qr_has_venue) ───────────
select throws_ok(
  $$ insert into public.sessions (id, host_id, type, duration_mode, qr_token)
       values ('11111111-1111-1111-1111-111111111111', '11111111-2222-3333-4444-555555555555',
               'static_qr', 'open_ended', 'no-venue-token') $$,
  NULL,
  'a static_qr session with no venue_id violates chk_static_qr_has_venue'
);

-- ── one active static_qr session per venue (partial unique index) ───
-- status must be 'active' here too -- the index is partial (where
-- status='active'), so a 'pending' row would never collide.
select throws_ok(
  $$ insert into public.sessions (id, host_id, venue_id, type, duration_mode, qr_token, status)
       values ('22222222-2222-2222-2222-222222222222', '11111111-2222-3333-4444-555555555555',
               'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', 'static_qr', 'open_ended',
               'a-second-concurrent-session-token', 'active') $$,
  NULL,
  'a second concurrently-active static_qr session at the same venue violates the partial unique index'
);

select ok(
  not has_function_privilege('authenticated', 'public.join_venue_session(uuid,text,uuid,int)', 'execute'),
  'authenticated cannot call join_venue_session directly (service_role-only)'
);

select * from finish();
rollback;
