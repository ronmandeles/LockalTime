-- pgTAP tests for Phase 5.5 (Push Notification Infrastructure). Accumulates
-- across the whole phase, same convention as phase5_gamification_test.sql /
-- phase6_hardening_test.sql (one file per phase rather than repeatedly
-- bumping older phases' plan() counts). Run with: supabase test db
--
-- Note (Phase 5 task 4's real lesson, restated in phase6_hardening_test.sql):
-- pgTAP runs as the postgres superuser, so it can prove a GRANT statement
-- exists (has_table_privilege) but cannot prove service_role's runtime
-- behavior against RLS the way a real integration test against the Data API
-- can. Grant existence is asserted here; end-to-end behavior is proven by
-- apps/server's integration suite.

begin;
select plan(21);

-- ── Task 1: device_tokens table + users.locale column ──────────────
select has_table('public', 'device_tokens', 'public.device_tokens table exists');
select has_column('public', 'users', 'locale', 'users gains locale');

select is(
  (select relrowsecurity from pg_class where oid = 'public.device_tokens'::regclass),
  true, 'RLS enabled on public.device_tokens'
);

select ok(
  has_table_privilege('service_role', 'public.device_tokens', 'select'),
  'service_role can select public.device_tokens (task 3 dispatch job needs this)'
);
select ok(
  not has_table_privilege('service_role', 'public.device_tokens', 'insert'),
  'service_role cannot insert public.device_tokens -- registration is always a direct client write'
);

-- ── Fixtures ────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'push-owner@test.dev'),
  ('44444444-4444-4444-4444-444444444444', 'push-other@test.dev');

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- ── Registration: a user can register their own device token ───────
select lives_ok(
  $$ insert into public.device_tokens (user_id, platform, token)
       values ('33333333-3333-3333-3333-333333333333', 'android', 'token-v1') $$,
  'a user can register their own device token'
);
select is(
  (select count(*)::int from public.device_tokens),
  1, 'the owner sees their own registered token'
);

-- ── Reinstall / re-registration: newest wins, no duplicate row ─────
select lives_ok(
  $$ insert into public.device_tokens (user_id, platform, token)
       values ('33333333-3333-3333-3333-333333333333', 'android', 'token-v2')
       on conflict (user_id, platform) do update
         set token = excluded.token, last_seen_at = now() $$,
  'reinstalling upserts on (user_id, platform) instead of erroring'
);
select is(
  (select count(*)::int from public.device_tokens),
  1, 'reinstalling replaces the old token row rather than duplicating it'
);
select is(
  (select token from public.device_tokens
     where user_id = '33333333-3333-3333-3333-333333333333' and platform = 'android'),
  'token-v2', 'the replaced row carries the new token value'
);

-- ── RLS: a user cannot see or write another user's token ───────────
select throws_ok(
  $$ insert into public.device_tokens (user_id, platform, token)
       values ('44444444-4444-4444-4444-444444444444', 'ios', 'stolen-token') $$,
  NULL,
  'a user cannot register a device token under a different user_id'
);

reset role;
insert into public.device_tokens (user_id, platform, token) values
  ('44444444-4444-4444-4444-444444444444', 'ios', 'other-users-token');

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*)::int from public.device_tokens),
  1, 'a user reading device_tokens only sees their own row, not another user''s'
);
-- An UPDATE's USING clause silently filters non-owned rows out of the
-- match set rather than raising -- it's a 0-row update, not an exception
-- (unlike the insert above, which fails its WITH CHECK loudly). Proven by
-- the target row surviving unchanged, not by throws_ok.
update public.device_tokens set token = 'hijacked'
  where user_id = '44444444-4444-4444-4444-444444444444';
reset role;
select is(
  (select token from public.device_tokens
     where user_id = '44444444-4444-4444-4444-444444444444'),
  'other-users-token',
  'a user''s attempted update to another user''s device token silently affects zero rows'
);
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

-- ── users.locale: user-editable, same posture as timezone ───────────
select lives_ok(
  $$ update public.users set locale = 'he'
       where id = '33333333-3333-3333-3333-333333333333' $$,
  'a user can set their own locale'
);
select throws_ok(
  $$ update public.users set role = 'admin'
       where id = '33333333-3333-3333-3333-333333333333' $$,
  NULL,
  'locale being editable does not reopen role (column-scoped grant unchanged)'
);

reset role;

-- ── Task 3: streak-risk claim function ──────────────────────────────
select has_column(
  'public', 'user_streaks', 'risk_notification_sent_for',
  'user_streaks gains risk_notification_sent_for (streak-risk claim dedup key)'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.claim_streak_risk_notifications(timestamptz,int)', 'execute'
  ),
  'authenticated cannot call claim_streak_risk_notifications directly (service_role-only)'
);

insert into auth.users (id, email) values
  ('55555555-5555-5555-5555-555555555555', 'risk-within-window@test.dev'),
  ('66666666-6666-6666-6666-666666666666', 'risk-outside-window@test.dev'),
  ('77777777-7777-7777-7777-777777777777', 'risk-broken-streak@test.dev');

insert into public.user_streaks (user_id, current_streak, longest_streak, streak_grace_expires_at)
values
  ('55555555-5555-5555-5555-555555555555', 3, 3, now() + interval '5 hours'),
  ('66666666-6666-6666-6666-666666666666', 2, 2, now() + interval '10 hours'),
  ('77777777-7777-7777-7777-777777777777', 0, 4, now() + interval '2 hours');

select set_eq(
  $$ select user_id from public.claim_streak_risk_notifications(now(), 6) $$,
  $$ values ('55555555-5555-5555-5555-555555555555'::uuid) $$,
  'only the streak within the 6h window with a live streak gets claimed -- an outside-window streak and an already-broken streak are both excluded'
);

select is(
  (select risk_notification_sent_for from public.user_streaks
     where user_id = '55555555-5555-5555-5555-555555555555'),
  (select streak_grace_expires_at from public.user_streaks
     where user_id = '55555555-5555-5555-5555-555555555555'),
  'the claimed row records exactly which deadline it was notified for'
);

select is(
  (select count(*)::int from public.claim_streak_risk_notifications(now(), 6)),
  0, 'an immediate second claim call does not re-claim the same still-pending deadline'
);

-- A fresh session pushes the deadline forward -- a new, distinct deadline
-- is eligible again even though this user was already notified once.
update public.user_streaks
  set streak_grace_expires_at = now() + interval '4 hours'
  where user_id = '55555555-5555-5555-5555-555555555555';

select set_eq(
  $$ select user_id from public.claim_streak_risk_notifications(now(), 6) $$,
  $$ values ('55555555-5555-5555-5555-555555555555'::uuid) $$,
  'a new grace deadline (advanced by a fresh session) is eligible again even after already being notified once'
);

select * from finish();
rollback;
