-- pgTAP tests for Phase 7 (Release Prep). Accumulates across the whole
-- phase, same convention as phase6_hardening_test.sql. Run with:
-- supabase test db
--
-- Task: account deletion cascades (20260801000000_account_deletion_cascades.sql).
-- Proves the FK actions actually behave as designed against real rows —
-- not just that the constraint definitions changed — since the whole point
-- of this migration is "deleting a real user with real history no longer
-- fails with a foreign-key violation."

begin;
select plan(15);

insert into auth.users (id, email) values
  ('70000000-0000-0000-0000-000000000001', 'p7-host@test.dev'),
  ('70000000-0000-0000-0000-000000000002', 'p7-alice@test.dev'),
  ('70000000-0000-0000-0000-000000000003', 'p7-bob@test.dev');

insert into public.venues (id, owner_id, name, qr_token) values
  ('70000000-0000-0000-0000-00000000a001', '70000000-0000-0000-0000-000000000001', 'Test Cafe', 'p7-test-venue-qr-token');

insert into public.sessions (id, host_id, venue_id, type, status, duration_mode, qr_token) values
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000001',
   '70000000-0000-0000-0000-00000000a001', 'dynamic_qr', 'completed', 'open_ended',
   'p7-test-qr-token');

insert into public.session_host_assignments (session_id, user_id, reason) values
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000001', 'initial_host');

insert into public.session_presence_intervals (session_id, user_id) values
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000002'),
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000003');

insert into public.session_participants (session_id, user_id, is_host, points_earned) values
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000002', false, 30),
  ('70000000-0000-0000-0000-00000000b001', '70000000-0000-0000-0000-000000000003', false, 30);

insert into public.device_attestations (user_id, session_id, platform, action, verdict, raw_response) values
  ('70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000b001', 'ios', 'join', 'not_configured', '{}'),
  ('70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000b001', 'android', 'join', 'not_configured', '{}');

insert into public.rewards_history (user_id, session_id, points, bonus_type) values
  ('70000000-0000-0000-0000-000000000002', '70000000-0000-0000-0000-00000000b001', 30, 'base'),
  ('70000000-0000-0000-0000-000000000003', '70000000-0000-0000-0000-00000000b001', 30, 'base');

-- ── Deleting a PARTICIPANT's account (bob) removes only his own rows ──
delete from auth.users where id = '70000000-0000-0000-0000-000000000003';

select is(
  (select count(*)::int from public.session_participants where user_id = '70000000-0000-0000-0000-000000000003'),
  0, 'bob''s own session_participants row is gone after he deletes his account'
);
select is(
  (select count(*)::int from public.session_presence_intervals where user_id = '70000000-0000-0000-0000-000000000003'),
  0, 'bob''s own session_presence_intervals rows are gone'
);
select is(
  (select count(*)::int from public.device_attestations where user_id = '70000000-0000-0000-0000-000000000003'),
  0, 'bob''s own device_attestations rows are gone'
);
select is(
  (select count(*)::int from public.rewards_history where user_id = '70000000-0000-0000-0000-000000000003'),
  0, 'bob''s own rewards_history rows are gone (his own receipt)'
);
select is(
  (select count(*)::int from public.sessions where id = '70000000-0000-0000-0000-00000000b001'),
  1, 'the session itself survives bob (a non-host participant) deleting his account'
);
select is(
  (select count(*)::int from public.session_participants where user_id = '70000000-0000-0000-0000-000000000002'),
  1, 'alice''s session_participants row is untouched by bob''s account deletion'
);

-- ── Deleting the HOST's account cascades the session, but protects ──
-- ── other participants' own reward receipts and the shared venue ────
delete from auth.users where id = '70000000-0000-0000-0000-000000000001';

select is(
  (select count(*)::int from public.sessions where id = '70000000-0000-0000-0000-00000000b001'),
  0, 'the session is deleted once its host deletes their account (host_id ON DELETE CASCADE)'
);
select is(
  (select count(*)::int from public.session_participants where session_id = '70000000-0000-0000-0000-00000000b001'),
  0, 'alice''s session_participants row for that session is gone too (session_id cascade, pre-existing)'
);
select is(
  (select count(*)::int from public.rewards_history where user_id = '70000000-0000-0000-0000-000000000002'),
  1, 'alice''s own rewards_history row SURVIVES the host''s account deletion (session_id SET NULL, not CASCADE)'
);
select is(
  (select session_id from public.rewards_history where user_id = '70000000-0000-0000-0000-000000000002'),
  null, 'alice''s surviving rewards_history row has session_id set null, not left dangling'
);
select is(
  (select count(*)::int from public.venues where id = '70000000-0000-0000-0000-00000000a001'),
  1, 'the venue survives its owning host''s account deletion (a shared B2B asset, not personal data)'
);
select is(
  (select owner_id from public.venues where id = '70000000-0000-0000-0000-00000000a001'),
  null, 'the orphaned venue''s owner_id is set null rather than left dangling'
);
select is(
  (select count(*)::int from public.users where id = '70000000-0000-0000-0000-000000000001'),
  0, 'the host''s public.users row is gone (cascaded from auth.users, pre-existing behavior)'
);
select is(
  (select count(*)::int from auth.users where id = '70000000-0000-0000-0000-000000000001'),
  0, 'the host''s auth.users row is actually gone'
);
select is(
  (select count(*)::int from public.users where id = '70000000-0000-0000-0000-000000000002'),
  1, 'alice, who never deleted her account, is completely unaffected'
);

select * from finish();
rollback;
