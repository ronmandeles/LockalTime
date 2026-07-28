-- pgTAP test for public.venues.
-- Run with: supabase test db
--
-- Phase 6 task 1 tightened the read policy from "any authenticated user"
-- to "owner only" (supabase/migrations/20260729000200_venues_ownership_and_grants.sql)
-- -- a deliberate hardening tighten, not a feature removal: nothing in the
-- app ever depended on a non-owner reading a venue row directly (a
-- joining participant learns a venue's name via the server-computed
-- session-preview endpoint, task 4, not RLS). This file's assertions
-- reflect that new behavior.

begin;
select plan(9);

select has_table('public', 'venues', 'public.venues table exists');
select col_is_pk('public', 'venues', 'id', 'id is the primary key');
select has_column('public', 'venues', 'owner_id', 'has owner_id');
select has_column('public', 'venues', 'name', 'has name');
select col_not_null('public', 'venues', 'name', 'name is NOT NULL');
select is(
  (select relrowsecurity from pg_class where oid = 'public.venues'::regclass),
  true,
  'row-level security is enabled on public.venues'
);

insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'venue-owner@test.dev'),
  ('55555555-5555-5555-5555-555555555555', 'someone-else@test.dev');
insert into public.venues (id, owner_id, name, qr_token) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333',
   'Test Cafe', 'fixture-venue-qr-token');

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*) from public.venues where id = '44444444-4444-4444-4444-444444444444')::int,
  1, 'the owner can read their own venue row'
);

select throws_ok(
  $$ insert into public.venues (owner_id, name) values
       ('33333333-3333-3333-3333-333333333333', 'Rogue Venue') $$,
  NULL,
  'authenticated cannot insert a venue directly (no grant — API-only)'
);

-- Switch to the OTHER user — must not see the first user's venue at all
-- (Phase 6 task 1's tightened policy).
reset role;
set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"55555555-5555-5555-5555-555555555555","role":"authenticated"}';

select is(
  (select count(*) from public.venues where id = '44444444-4444-4444-4444-444444444444')::int,
  0, 'a non-owner cannot read another host''s venue row'
);

select * from finish();
rollback;
