-- pgTAP tests for Phase 6.5 (Social & Comparison Surfaces). Accumulates
-- across the whole phase, same convention as phase5_5_push_notifications_test.sql
-- / phase6_hardening_test.sql. Run with: supabase test db
--
-- Note: pgTAP runs as the postgres superuser, so it can call
-- send_friend_request()/respond_to_friend_request() directly (bypassing
-- the service_role-only grant, same as every other Node-only function's
-- own test file) and can prove a GRANT exists (has_table_privilege), but
-- not service_role's runtime behavior against RLS the way a real
-- integration test against the Data API can -- that's
-- apps/server/integration/friends.integration.test.ts's job (task 3/4).

begin;
select plan(29);

-- ── Task 1 shape (users.username) already covered by users_trigger_test.sql ──

-- ── Task 2: friend graph shape ───────────────────────────────────────
select has_table('public', 'friend_requests', 'public.friend_requests table exists');
select has_table('public', 'friendships', 'public.friendships table exists');
select is(
  (select relrowsecurity from pg_class where oid = 'public.friend_requests'::regclass),
  true, 'RLS enabled on public.friend_requests'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.friendships'::regclass),
  true, 'RLS enabled on public.friendships'
);
select ok(
  not has_function_privilege('authenticated', 'public.send_friend_request(uuid,uuid)', 'execute'),
  'authenticated cannot call send_friend_request directly (service_role-only)'
);
select ok(
  not has_function_privilege(
    'authenticated', 'public.respond_to_friend_request(uuid,uuid,boolean)', 'execute'
  ),
  'authenticated cannot call respond_to_friend_request directly (service_role-only)'
);

-- ── Fixtures ────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('a1111111-1111-1111-1111-111111111111', 'friend-a@test.dev'),
  ('b2222222-2222-2222-2222-222222222222', 'friend-b@test.dev'),
  ('c3333333-3333-3333-3333-333333333333', 'friend-c@test.dev'),
  ('d4444444-4444-4444-4444-444444444444', 'friend-d@test.dev'),
  ('e5555555-5555-5555-5555-555555555555', 'friend-e@test.dev'),
  ('f6666666-6666-6666-6666-666666666666', 'friend-f@test.dev'),
  ('99999999-1111-1111-1111-111111111111', 'friend-h@test.dev');

-- ── send_friend_request(): fresh, idempotent, self-request ──────────
select is(
  public.send_friend_request('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222'),
  'requested', 'a fresh request returns ''requested'' and creates one row'
);
select is(
  (select count(*)::int from public.friend_requests
     where requester_id = 'a1111111-1111-1111-1111-111111111111'
       and recipient_id = 'b2222222-2222-2222-2222-222222222222'),
  1, 'exactly one request row exists after sending'
);
select is(
  public.send_friend_request('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222'),
  'already_requested', 'sending the same request again is idempotent, not a duplicate'
);
select is(
  public.send_friend_request('a1111111-1111-1111-1111-111111111111', 'a1111111-1111-1111-1111-111111111111'),
  'invalid_recipient', 'a user cannot send a friend request to themselves'
);

-- ── Mutual double-request auto-resolves to a friendship ─────────────
select is(
  public.send_friend_request('b2222222-2222-2222-2222-222222222222', 'a1111111-1111-1111-1111-111111111111'),
  'friends', 'a reverse request while one is already pending auto-accepts into a friendship'
);
select is(
  (select count(*)::int from public.friend_requests
     where (requester_id = 'a1111111-1111-1111-1111-111111111111'
            and recipient_id = 'b2222222-2222-2222-2222-222222222222')
        or (requester_id = 'b2222222-2222-2222-2222-222222222222'
            and recipient_id = 'a1111111-1111-1111-1111-111111111111')),
  0, 'both directions'' pending requests are gone once auto-accepted'
);
select is(
  (select count(*)::int from public.friendships
     where user_id_a = 'a1111111-1111-1111-1111-111111111111'
       and user_id_b = 'b2222222-2222-2222-2222-222222222222'),
  1, 'exactly one canonically-ordered friendship row was created'
);
select is(
  public.send_friend_request('a1111111-1111-1111-1111-111111111111', 'b2222222-2222-2222-2222-222222222222'),
  'already_friends', 'sending a request to an existing friend is rejected as already_friends'
);

-- ── respond_to_friend_request(): accept ──────────────────────────────
select public.send_friend_request('c3333333-3333-3333-3333-333333333333', 'a1111111-1111-1111-1111-111111111111');
select is(
  public.respond_to_friend_request(
    'a1111111-1111-1111-1111-111111111111',
    (select id from public.friend_requests
       where requester_id = 'c3333333-3333-3333-3333-333333333333'
         and recipient_id = 'a1111111-1111-1111-1111-111111111111'),
    true
  ),
  'accepted', 'the recipient accepting a request returns ''accepted'''
);
select is(
  (select count(*)::int from public.friendships
     where user_id_a = 'a1111111-1111-1111-1111-111111111111'
       and user_id_b = 'c3333333-3333-3333-3333-333333333333'),
  1, 'accepting creates the canonically-ordered friendship row'
);

-- ── respond_to_friend_request(): decline ─────────────────────────────
select public.send_friend_request('d4444444-4444-4444-4444-444444444444', 'e5555555-5555-5555-5555-555555555555');
select is(
  public.respond_to_friend_request(
    'e5555555-5555-5555-5555-555555555555',
    (select id from public.friend_requests
       where requester_id = 'd4444444-4444-4444-4444-444444444444'
         and recipient_id = 'e5555555-5555-5555-5555-555555555555'),
    false
  ),
  'declined', 'the recipient declining a request returns ''declined'''
);
select is(
  (select count(*)::int from public.friend_requests
     where requester_id = 'd4444444-4444-4444-4444-444444444444'
       and recipient_id = 'e5555555-5555-5555-5555-555555555555'),
  0, 'a declined request is removed, not left in a terminal status'
);
select is(
  (select count(*)::int from public.friendships
     where (user_id_a = 'd4444444-4444-4444-4444-444444444444'
            or user_id_b = 'd4444444-4444-4444-4444-444444444444')
       and (user_id_a = 'e5555555-5555-5555-5555-555555555555'
            or user_id_b = 'e5555555-5555-5555-5555-555555555555')),
  0, 'declining never creates a friendship'
);

-- ── Non-recipient cannot respond to someone else's request ──────────
select public.send_friend_request('f6666666-6666-6666-6666-666666666666', '99999999-1111-1111-1111-111111111111');
select is(
  public.respond_to_friend_request(
    'd4444444-4444-4444-4444-444444444444',
    (select id from public.friend_requests
       where requester_id = 'f6666666-6666-6666-6666-666666666666'
         and recipient_id = '99999999-1111-1111-1111-111111111111'),
    true
  ),
  'not_found', 'a user who is not the recipient cannot respond to a request, and it isn''t confirmed to exist'
);

-- ── RLS: requests ────────────────────────────────────────────────────
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"f6666666-6666-6666-6666-666666666666","role":"authenticated"}';
select is(
  (select count(*)::int from public.friend_requests),
  1, 'the requester sees their own pending request'
);
select throws_ok(
  $$ insert into public.friend_requests (requester_id, recipient_id)
       values ('f6666666-6666-6666-6666-666666666666'::uuid, '99999999-1111-1111-1111-111111111111'::uuid) $$,
  NULL,
  'a duplicate pending request is rejected by the unique constraint'
);
reset role;

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"d4444444-4444-4444-4444-444444444444","role":"authenticated"}';
select throws_ok(
  $$ insert into public.friend_requests (requester_id, recipient_id)
       values ('e5555555-5555-5555-5555-555555555555'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid) $$,
  NULL,
  'a user cannot insert a request claiming to be a different requester'
);
select is(
  (select count(*)::int from public.friend_requests
     where requester_id = 'f6666666-6666-6666-6666-666666666666'),
  0, 'an unrelated third party sees none of another pair''s pending requests'
);

-- ── RLS: friendships ─────────────────────────────────────────────────
select is(
  (select count(*)::int from public.friendships),
  0, 'a user with no friendships sees none, including other pairs'' rows'
);
select throws_ok(
  $$ insert into public.friendships (user_id_a, user_id_b)
       values ('a1111111-1111-1111-1111-111111111111'::uuid, 'd4444444-4444-4444-4444-444444444444'::uuid) $$,
  NULL,
  'authenticated cannot insert a friendship directly (function-only)'
);
reset role;

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"a1111111-1111-1111-1111-111111111111","role":"authenticated"}';
select is(
  (select count(*)::int from public.friendships),
  2, 'a user sees exactly their own friendship rows (with b and c)'
);
select lives_ok(
  $$ delete from public.friendships
       where user_id_a = 'a1111111-1111-1111-1111-111111111111'
         and user_id_b = 'b2222222-2222-2222-2222-222222222222' $$,
  'either party can unfriend via a direct RLS-scoped delete'
);
reset role;
select is(
  (select count(*)::int from public.friendships
     where user_id_a = 'a1111111-1111-1111-1111-111111111111'
       and user_id_b = 'b2222222-2222-2222-2222-222222222222'),
  0, 'the unfriended row is actually gone'
);

select * from finish();
rollback;
