-- pgTAP test for the signup trigger: auto-create a public.users profile row
-- whenever a row is inserted into auth.users (all three providers).
-- Run with: supabase test db
--
-- Signup is simulated at the DB level by inserting synthetic auth.users rows —
-- that is exactly what GoTrue does on signup, for email OTP and OAuth alike;
-- supabase-js is not involved at this layer.
--
-- Pinned contract (Stage A of TDD — implementation follows):
--   * function public.handle_new_user(), SECURITY DEFINER with a fixed
--     search_path (standard Supabase practice: the insert must succeed under
--     supabase_auth_admin, which has no rights on public.users, and a definer
--     function without a pinned search_path is hijackable).
--   * trigger on_auth_user_created AFTER INSERT ON auth.users.
--   * display_name derivation, first non-empty wins:
--       raw_user_meta_data->>'full_name'   (Google/Apple id-token shape)
--       raw_user_meta_data->>'name'        (variant key some providers use)
--       split_part(email, '@', 1)          (email OTP has no name metadata;
--                                           local-part is human-readable and
--                                           the user can edit it later via the
--                                           existing column-scoped UPDATE grant)
--       'user'                             (final guard — display_name is
--                                           NOT NULL and must never blow up
--                                           the auth insert)
--   * insert uses ON CONFLICT (id) DO NOTHING so a pre-existing profile row
--     never errors the signup.

begin;
select plan(19);

-- ── Trigger + function exist and are wired together ─────────────────
select has_function(
  'public', 'handle_new_user', '{}'::name[],
  'public.handle_new_user() exists');
select has_trigger(
  'auth', 'users', 'on_auth_user_created',
  'on_auth_user_created trigger exists on auth.users');
select trigger_is(
  'auth', 'users', 'on_auth_user_created', 'public', 'handle_new_user',
  'trigger fires public.handle_new_user');

-- ── SECURITY DEFINER + pinned search_path ───────────────────────────
select is_definer(
  'public', 'handle_new_user', '{}'::name[],
  'handle_new_user is SECURITY DEFINER (insert works under supabase_auth_admin)');
select ok(
  exists (
    select 1
      from pg_proc
     where oid = to_regproc('public.handle_new_user')
       and proconfig is not null
       and exists (
         select 1 from unnest(proconfig) as setting
          where setting like 'search_path=%'
       )
  ),
  'handle_new_user pins a fixed search_path (definer fn is not hijackable)');

-- ── OAuth-shaped signup: full_name metadata (Google/Apple) ──────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333333333', 'alice@test.dev',
   '{"full_name": "Alice Cohen"}');
select is(
  (select display_name from public.users
     where id = '33333333-3333-3333-3333-333333333333'),
  'Alice Cohen', 'OAuth signup with full_name creates profile with that display_name');
select is(
  (select role from public.users
     where id = '33333333-3333-3333-3333-333333333333'),
  'user', 'auto-created profile row gets default role ''user''');

-- ── Phase 6.5: username auto-generation ──────────────────────────────
select has_column('public', 'users', 'username', 'users gains username');
select is(
  (select username from public.users
     where id = '33333333-3333-3333-3333-333333333333'),
  'alicecohen', 'username is display_name lowercased with non-alphanumerics stripped');

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999999', 'alice2@test.dev',
   '{"full_name": "Alice Cohen"}');
select is(
  (select username from public.users
     where id = '99999999-9999-9999-9999-999999999999'),
  'alicecohen1', 'a second signup sharing a display_name gets a numeric-suffixed username instead of colliding');

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999998', 'alice3@test.dev',
   '{"full_name": "Alice Cohen"}');
select is(
  (select username from public.users
     where id = '99999999-9999-9999-9999-999999999998'),
  'alicecohen2', 'a third signup sharing the same display_name resolves to the next free suffix');

insert into auth.users (id, email, raw_user_meta_data) values
  ('99999999-9999-9999-9999-999999999997', 'punctuated@test.dev',
   '{"full_name": "!!! ??? ---"}');
select is(
  (select username from public.users
     where id = '99999999-9999-9999-9999-999999999997'),
  'user', 'a display_name that strips to nothing falls back to ''user'' as the username base, never aborting signup');

-- ── Email OTP signup: no metadata → email local-part fallback ───────
insert into auth.users (id, email) values
  ('44444444-4444-4444-4444-444444444444', 'dana@test.dev');
select is(
  (select display_name from public.users
     where id = '44444444-4444-4444-4444-444444444444'),
  'dana', 'email-only OTP signup falls back to the email local-part');

-- ── Metadata variants ───────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('55555555-5555-5555-5555-555555555555', 'bob@test.dev',
   '{"name": "Bob Levi"}');
select is(
  (select display_name from public.users
     where id = '55555555-5555-5555-5555-555555555555'),
  'Bob Levi', '''name'' metadata key is used when ''full_name'' is absent');

insert into auth.users (id, email, raw_user_meta_data) values
  ('66666666-6666-6666-6666-666666666666', 'empty@test.dev',
   '{"full_name": "", "name": ""}');
select is(
  (select display_name from public.users
     where id = '66666666-6666-6666-6666-666666666666'),
  'empty', 'empty-string name metadata falls through to the email local-part');

-- No email and no metadata (e.g. future phone/anonymous auth): display_name
-- is NOT NULL, so the trigger must still produce something — pinned to 'user'.
insert into auth.users (id) values
  ('88888888-8888-8888-8888-888888888888');
select is(
  (select display_name from public.users
     where id = '88888888-8888-8888-8888-888888888888'),
  'user', 'no email and no metadata still yields the ''user'' final fallback');

-- ── Full lifecycle: deleting the auth user cascades the profile ─────
delete from auth.users where id = '33333333-3333-3333-3333-333333333333';
select is(
  (select count(*) from public.users
     where id = '33333333-3333-3333-3333-333333333333')::int,
  0, 'deleting the auth.users row cascades away the public.users row');

-- ── Conflict safety: pre-existing profile row must not error signup ──
-- The FK (public.users.id → auth.users.id) makes this state unreachable by
-- normal inserts, so we drop the constraint inside this rolled-back
-- transaction purely to stage it. The trigger must be ON CONFLICT DO NOTHING:
-- a duplicate-key error here would abort the auth insert and break signup.
alter table public.users drop constraint users_id_fkey;
insert into public.users (id, display_name, username) values
  ('77777777-7777-7777-7777-777777777777', 'Preexisting', 'preexisting');
select lives_ok(
  $$ insert into auth.users (id, email, raw_user_meta_data) values
       ('77777777-7777-7777-7777-777777777777', 'dup@test.dev',
        '{"full_name": "Dup Name"}') $$,
  'auth insert does not error when a profile row already exists for that id');
select is(
  (select display_name from public.users
     where id = '77777777-7777-7777-7777-777777777777'),
  'Preexisting', 'pre-existing profile row is left untouched (on conflict do nothing)');

select * from finish();
rollback;
