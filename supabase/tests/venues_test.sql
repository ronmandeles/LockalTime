-- pgTAP test for public.venues.
-- Run with: supabase test db

begin;
select plan(8);

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

-- Display-only, no money-equivalent data: any authenticated user may read
-- venue rows (needed to show a venue name before joining a static_qr
-- session), but writes are Node-API-only (no INSERT/UPDATE grant exists).
insert into auth.users (id, email) values
  ('33333333-3333-3333-3333-333333333333', 'venue-owner@test.dev');
insert into public.venues (id, owner_id, name) values
  ('44444444-4444-4444-4444-444444444444', '33333333-3333-3333-3333-333333333333', 'Test Cafe');

set local role authenticated;
set local "request.jwt.claims" to
  '{"sub":"33333333-3333-3333-3333-333333333333","role":"authenticated"}';

select is(
  (select count(*) from public.venues where id = '44444444-4444-4444-4444-444444444444')::int,
  1, 'any authenticated user can read a venue row'
);

select throws_ok(
  $$ insert into public.venues (owner_id, name) values
       ('33333333-3333-3333-3333-333333333333', 'Rogue Venue') $$,
  NULL,
  'authenticated cannot insert a venue directly (no grant — API-only)'
);

select * from finish();
rollback;
