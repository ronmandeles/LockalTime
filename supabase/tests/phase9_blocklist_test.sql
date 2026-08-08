-- pgTAP tests for Phase 9 (Host-selected Blocklist). Accumulates across the
-- whole phase, same convention as phase6_hardening_test.sql /
-- phase7_release_prep_test.sql. Run with: supabase test db
--
-- Task 1: sessions.blocked_categories / blocked_packages and the venue's
-- approved counterparts (20260807000000_host_selected_blocklist.sql).
--
-- Two things here are asserted rather than assumed, both called out in
-- docs/BLOCKLIST_SELECTION_PLAN.md §3:
--   * the column DEFAULT reproduces today's hardcoded three categories, so
--     any code path not yet updated keeps enforcing exactly what it did
--     before this migration;
--   * `grant select on table` is table-wide and therefore already covers
--     columns added later — worth proving rather than trusting, since a
--     missing grant fails as `permission denied` at runtime, not at migrate
--     time.

begin;
select plan(23);

-- ── Columns exist and are non-nullable ──────────────────────────────────
select has_column('public', 'sessions', 'blocked_categories', 'public.sessions gains blocked_categories');
select has_column('public', 'sessions', 'blocked_packages', 'public.sessions gains blocked_packages');
select col_not_null('public', 'sessions', 'blocked_categories', 'blocked_categories is not null (the empty case is an empty array, never null)');
select col_not_null('public', 'sessions', 'blocked_packages', 'blocked_packages is not null (the empty case is an empty array, never null)');

select has_column('public', 'venues', 'approved_blocked_categories', 'public.venues gains approved_blocked_categories');
select has_column('public', 'venues', 'approved_blocked_packages', 'public.venues gains approved_blocked_packages');

insert into auth.users (id, email) values
  ('90000000-0000-0000-0000-000000000001', 'p9-host@test.dev');

-- ── Defaults reproduce today's behaviour ────────────────────────────────
insert into public.sessions (id, host_id, type, status, duration_mode) values
  ('90000000-0000-0000-0000-00000000b001', '90000000-0000-0000-0000-000000000001',
   'solo', 'active', 'open_ended');

select is(
  (select blocked_categories from public.sessions where id = '90000000-0000-0000-0000-00000000b001'),
  array['social', 'games', 'entertainment'],
  'a session created without a blocklist defaults to the historical three categories'
);
select is(
  (select blocked_packages from public.sessions where id = '90000000-0000-0000-0000-00000000b001'),
  array[]::text[],
  'a session created without a blocklist names no specific packages'
);

insert into public.venues (id, owner_id, name, qr_token) values
  ('90000000-0000-0000-0000-00000000a001', '90000000-0000-0000-0000-000000000001', 'P9 Cafe', 'p9-venue-qr-token');

select is(
  (select approved_blocked_categories from public.venues where id = '90000000-0000-0000-0000-00000000a001'),
  array['social', 'games', 'entertainment'],
  'a new venue is approved for the three default categories, so it is useful immediately (plan §3)'
);
select is(
  (select approved_blocked_packages from public.venues where id = '90000000-0000-0000-0000-00000000a001'),
  array[]::text[],
  'a new venue has no specifically approved apps until the owner grants some out of band'
);

-- ── The category vocabulary is exactly the six ──────────────────────────
select lives_ok(
  $$insert into public.sessions (id, host_id, type, status, duration_mode, blocked_categories)
    values ('90000000-0000-0000-0000-00000000b002', '90000000-0000-0000-0000-000000000001',
            'solo', 'active', 'open_ended',
            array['social', 'games', 'entertainment', 'news', 'maps', 'productivity'])$$,
  'all six categories are accepted'
);
select throws_ok(
  $$insert into public.sessions (id, host_id, type, status, duration_mode, blocked_categories)
    values ('90000000-0000-0000-0000-00000000b003', '90000000-0000-0000-0000-000000000001',
            'solo', 'active', 'open_ended', array['social', 'photography'])$$,
  '23514',
  null,
  'a category outside the six is rejected by chk_blocked_categories_valid'
);
select throws_ok(
  $$update public.venues set approved_blocked_categories = array['social', 'photography']
    where id = '90000000-0000-0000-0000-00000000a001'$$,
  '23514',
  null,
  'a venue cannot be approved for a category outside the six either'
);

-- ── A session must block something ──────────────────────────────────────
select throws_ok(
  $$insert into public.sessions (id, host_id, type, status, duration_mode, blocked_categories, blocked_packages)
    values ('90000000-0000-0000-0000-00000000b004', '90000000-0000-0000-0000-000000000001',
            'solo', 'active', 'open_ended', array[]::text[], array[]::text[])$$,
  '23514',
  null,
  'a session blocking nothing at all is rejected by chk_blocklist_non_empty'
);
select lives_ok(
  $$insert into public.sessions (id, host_id, type, status, duration_mode, blocked_categories, blocked_packages)
    values ('90000000-0000-0000-0000-00000000b005', '90000000-0000-0000-0000-000000000001',
            'solo', 'active', 'open_ended', array[]::text[], array['com.instagram.android'])$$,
  'a blocklist of specific apps and no categories is a valid session'
);

-- ── The blocklist stays a mutable column (plan §9a: the freeze is a ──────
-- ── server-side policy, deliberately not a structural assumption) ───────
select lives_ok(
  $$update public.sessions
    set blocked_packages = array['com.instagram.android', 'com.zhiliaoapp.musically']
    where id = '90000000-0000-0000-0000-00000000b005'$$,
  'the column itself is mutable, leaving room for the premium add-only editing §9a keeps open'
);

-- ── Grants: table-wide, so already covering the new columns ─────────────
select ok(
  has_column_privilege('authenticated', 'public.sessions', 'blocked_categories', 'select'),
  'the pre-existing table-wide select grant already covers sessions.blocked_categories'
);
select ok(
  has_column_privilege('authenticated', 'public.sessions', 'blocked_packages', 'select'),
  'the pre-existing table-wide select grant already covers sessions.blocked_packages'
);
select ok(
  has_column_privilege('authenticated', 'public.venues', 'approved_blocked_categories', 'select'),
  'a client can read a venue''s approved set, so the picker can narrow itself before the server has to reject'
);
select ok(
  not has_column_privilege('authenticated', 'public.sessions', 'blocked_categories', 'update'),
  'a client still cannot write a blocklist directly — every write goes through the Node API'
);
select ok(
  has_column_privilege('service_role', 'public.sessions', 'blocked_categories', 'insert'),
  'the Node API can write a blocklist at session creation'
);
select ok(
  has_column_privilege('service_role', 'public.sessions', 'blocked_packages', 'update'),
  'the Node API retains update on the new columns (the mid-session re-push path §9a leaves room for)'
);
select ok(
  not has_column_privilege('authenticated', 'public.venues', 'approved_blocked_categories', 'update'),
  'a venue owner cannot self-approve a blocklist — approval is out of band, like Verified Host itself'
);

select * from finish();
rollback;
