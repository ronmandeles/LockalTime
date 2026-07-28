-- pgTAP tests for Phase 6 (Hardening & B2B). Accumulates across the whole
-- phase, same convention as phase4_lifecycle_test.sql / phase5_gamification_test.sql
-- (one file per phase rather than repeatedly bumping older phases' plan()
-- counts). Run with: supabase test db
--
-- Note (Phase 5 task 4's real lesson): pgTAP runs as the postgres superuser,
-- so it can prove a GRANT statement exists (has_table_privilege) but cannot
-- prove service_role's runtime behavior against RLS the way a real
-- integration test against the Data API can. Grant existence is asserted
-- here; end-to-end behavior is proven by apps/server's integration suite.

begin;
select plan(12);

-- ── Task 6.0: role authorization primitive ─────────────────────────
select ok(
  has_table_privilege('service_role', 'public.users', 'select'),
  'service_role can select public.users (getUserRole() needs this)'
);
select ok(
  not has_table_privilege('service_role', 'public.users', 'update'),
  'service_role still cannot UPDATE public.users -- role flip stays manual SQL, never a Node write path'
);

-- ── Task 6.1: venues grants (the original migration's live gap) ────
select ok(
  has_table_privilege('service_role', 'public.venues', 'insert'),
  'service_role can insert public.venues (venues.router.ts create-venue needs this)'
);
select ok(
  has_table_privilege('service_role', 'public.venues', 'update'),
  'service_role can update public.venues (qr regeneration, task 2, needs this)'
);
select ok(
  has_table_privilege('service_role', 'public.venues', 'select'),
  'service_role can select public.venues (getVenueById ownership check needs this)'
);

-- ── Task 6.5: get_venue_metrics() ───────────────────────────────────
insert into auth.users (id, email) values
  ('99999999-0000-0000-0000-000000000001', 'metrics-host@test.dev'),
  ('99999999-0000-0000-0000-000000000002', 'metrics-customer-1@test.dev'),
  ('99999999-0000-0000-0000-000000000003', 'metrics-customer-2@test.dev');

insert into public.venues (id, owner_id, name, qr_token) values
  ('99999999-1111-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001',
   'Metrics Cafe', 'metrics-venue-token');

-- An in-window session with two finalized participants (30 and 50 minutes
-- present -- avg should be 40) and one OPEN interval (counts toward
-- concurrent_active_customers, not toward the average -- that's only
-- computed from already-finalized session_participants rows).
insert into public.sessions (id, host_id, venue_id, type, duration_mode, qr_token, status, started_at)
  values ('99999999-2222-0000-0000-000000000001', '99999999-0000-0000-0000-000000000001',
          '99999999-1111-0000-0000-000000000001', 'static_qr', 'open_ended',
          'metrics-session-token', 'active', now() - interval '2 days');

insert into public.session_participants (session_id, user_id, total_minutes_present, exit_reason, points_earned)
  values
    ('99999999-2222-0000-0000-000000000001', '99999999-0000-0000-0000-000000000002', 30, 'completed', 30),
    ('99999999-2222-0000-0000-000000000001', '99999999-0000-0000-0000-000000000003', 50, 'completed', 50);

insert into public.session_presence_intervals (session_id, user_id, left_at)
  values ('99999999-2222-0000-0000-000000000001', '99999999-0000-0000-0000-000000000002', null);

-- A session at the same venue OUTSIDE the 30-day window -- must not count
-- toward sessions_in_window or the average.
insert into public.sessions (id, host_id, venue_id, type, duration_mode, qr_token, status, started_at)
  values ('99999999-2222-0000-0000-000000000002', '99999999-0000-0000-0000-000000000001',
          '99999999-1111-0000-0000-000000000001', 'static_qr', 'open_ended',
          'metrics-old-session-token', 'completed', now() - interval '60 days');
insert into public.session_participants (session_id, user_id, total_minutes_present, exit_reason, points_earned)
  values ('99999999-2222-0000-0000-000000000002', '99999999-0000-0000-0000-000000000002', 999, 'completed', 999);

select is(
  (select concurrent_active_customers from public.get_venue_metrics(
    '99999999-1111-0000-0000-000000000001', now() - interval '30 days')),
  1, 'concurrent_active_customers counts only currently-open intervals on active sessions at this venue'
);
select is(
  (select sessions_in_window from public.get_venue_metrics(
    '99999999-1111-0000-0000-000000000001', now() - interval '30 days')),
  1, 'sessions_in_window excludes the 60-day-old session'
);
select is(
  (select avg_minutes_per_customer from public.get_venue_metrics(
    '99999999-1111-0000-0000-000000000001', now() - interval '30 days')),
  40.0000000000000000::numeric,
  'avg_minutes_per_customer averages only in-window finalized participants (30, 50 -> 40)'
);
select ok(
  not has_function_privilege('authenticated', 'public.get_venue_metrics(uuid,timestamptz)', 'execute'),
  'authenticated cannot call get_venue_metrics directly (service_role-only)'
);

-- ── Tasks 6.8-6.9: device trust tier gates the streak, never lifetime
-- stats ────────────────────────────────────────────────────────────
insert into auth.users (id, email) values
  ('99999999-3333-0000-0000-000000000001', 'unverified-device@test.dev');
insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes)
  values ('99999999-4444-0000-0000-000000000001', '99999999-3333-0000-0000-000000000001',
          'solo', 'fixed', 30);
insert into public.session_participants
  (session_id, user_id, is_host, total_minutes_present, exit_reason, points_earned)
  values ('99999999-4444-0000-0000-000000000001', '99999999-3333-0000-0000-000000000001',
          true, 30, 'completed', 30);

select is(
  public.apply_session_stats(
    '99999999-4444-0000-0000-000000000001'::uuid,
    '99999999-3333-0000-0000-000000000001'::uuid,
    '2026-08-01T12:00:00Z'::timestamptz, 48, 'unverified'
  ), 'applied', 'an unverified device still applies (lifetime stats are never gated)'
);
select is(
  (select total_points from public.user_stats
     where user_id = '99999999-3333-0000-0000-000000000001'),
  30, 'lifetime total_points accumulated normally despite the unverified device'
);
select is(
  coalesce((select current_streak from public.user_streaks
     where user_id = '99999999-3333-0000-0000-000000000001'), 0),
  0, 'the streak is NOT advanced for an unverified device (bonus/streak-only exclusion)'
);

select * from finish();
rollback;
