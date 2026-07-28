-- pgTAP test for public.apply_session_stats(): the single atomic entry
-- point that accumulates a finalized session_participants row into
-- user_stats / user_stats_daily / user_streaks / user_milestones (+
-- rewards_history for any milestone crossed). Test-first contract for
-- Phase 5 task 3 (backlog.md). Run with: supabase test db
--
-- Why a DB function and not Node read-modify-write: apply_session_stats()
-- is called from TWO independent Node finalization paths (end-session.ts,
-- finalize-emergency-exit.ts), which can race the sweep worker. A
-- Node-side "read streak, compute, write streak" has a lost-update window
-- no amount of application-level care closes; this function does the
-- whole read-decide-write cycle under a single row lock inside one
-- transaction, the same precedent as join_session()/rejoin_session().

begin;
select plan(22);

insert into auth.users (id, email) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'streaker@test.dev'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'other@test.dev');

update public.users set timezone = 'Asia/Jerusalem' -- UTC+3 for every August date used below (Israel Summer Time)
  where id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- A single reusable session; each test uses a fresh user or a fresh
-- session_participants row rather than truncating between assertions.
insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes)
  values ('bbbbbbbb-0000-0000-0000-000000000001',
          'aaaaaaaa-0000-0000-0000-000000000001', 'solo', 'fixed', 30);

-- ── Helper: seed a finalized (but not yet stats-applied) participant row ──
-- session_id is reused across tests via distinct fake session ids so each
-- assertion's row is independent (rewards_history/user_stats_daily are
-- additive, so distinct sessions keep the arithmetic easy to reason about).
create or replace function pg_temp.seed_participant(
  p_session_id uuid, p_user_id uuid, p_exit_reason text,
  p_minutes int, p_points int
) returns void language sql as $$
  insert into public.sessions (id, host_id, type, duration_mode, planned_duration_minutes)
    values (p_session_id, p_user_id, 'solo', 'fixed', 30)
    on conflict (id) do nothing;
  insert into public.session_participants
    (session_id, user_id, is_host, total_minutes_present, exit_reason, points_earned)
    values (p_session_id, p_user_id, true, p_minutes, p_exit_reason, p_points);
  insert into public.rewards_history (user_id, session_id, points, bonus_type)
    values (p_user_id, p_session_id, p_points, 'base');
$$;

-- ── 1. Basic accumulation + exactly-once idempotency ───────────────────
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000001'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'completed', 45, 45
);
select is(
  public.apply_session_stats(
    '10000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    '2026-08-01T12:00:00Z'::timestamptz, 48
  ), 'applied', 'first application returns applied'
);
select is(
  (select total_minutes from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  45, 'total_minutes accumulated'
);
select is(
  (select sessions_completed from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'sessions_completed incremented for a completed exit'
);
select is(
  public.apply_session_stats(
    '10000000-0000-0000-0000-000000000001'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    '2026-08-01T12:00:00Z'::timestamptz, 48
  ), 'skipped', 're-applying the same session_participants row is a no-op'
);
select is(
  (select total_minutes from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  45, 'total_minutes did not double-count on the skipped re-application'
);
select is(
  public.apply_session_stats(
    'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid,
    'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
    now(), 48
  ), 'skipped', 'a session_participants row that does not exist is skipped, not an error'
);

-- ── 2. exit_reason routing (emergency_exit / disconnected counters) ────
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'emergency_exit', 10, 10
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000002'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  '2026-08-01T13:00:00Z'::timestamptz, 48
);
select is(
  (select sessions_emergency_exit from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'sessions_emergency_exit routed correctly and does not touch sessions_completed'
);

select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'disconnected', 5, 5
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000003'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  '2026-08-01T14:00:00Z'::timestamptz, 48
);
select is(
  (select sessions_disconnected from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  1, 'sessions_disconnected routed correctly (Phase 5 deviation column)'
);

-- ── 3. Streak: DoD boundaries -- 47h survives, 49h breaks ──────────────
-- Fresh user, isolated from the accumulation above.
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000010'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'completed', 20, 20
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000010'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '2026-08-01T00:00:00Z'::timestamptz, 48
);
select is(
  (select current_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1, 'first-ever contributing session starts the streak at 1'
);

select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000011'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'completed', 20, 20
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000011'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '2026-08-02T23:00:00Z'::timestamptz, 48  -- exactly 47h after the first
);
select is(
  (select current_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  2, 'DoD: a 47h gap survives -- streak advances to 2'
);

select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000012'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'completed', 20, 20
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000012'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '2026-08-05T00:00:00Z'::timestamptz, 48  -- 49h after the second session
);
select is(
  (select current_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1, 'DoD: a 49h gap breaks the streak -- resets to 1, not incremented to 3'
);
select is(
  (select longest_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  2, 'longest_streak preserves the earlier high-water mark after a break'
);

-- ── 4. Same local day does not double-increment ────────────────────────
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000013'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'completed', 15, 15
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000013'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '2026-08-05T01:00:00Z'::timestamptz, 48  -- same UTC day as the break-reset above
);
select is(
  (select current_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1, 'a second qualifying session on the same local day does not double-count'
);

-- ── 5. Out-of-order finalization never moves the streak backwards ──────
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000014'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  'completed', 15, 15
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000014'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000002'::uuid,
  '2026-08-01T06:00:00Z'::timestamptz, 48  -- earlier than last_session_at, arrives late
);
select is(
  (select current_streak from public.user_streaks where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1, 'a stale out-of-order finalization does not perturb the streak'
);
select is(
  (select total_minutes from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  90, -- 20+20+20 (streak tests) + 15 (same-day test) + 15 (this out-of-order test)
  'stats still accumulate for an out-of-order finalization even though the streak does not move'
);

-- ── 6. Timezone bucketing: a UTC+3 session can land on the NEXT local day ──
select pg_temp.seed_participant(
  '10000000-0000-0000-0000-000000000020'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  'completed', 5, 5
);
select public.apply_session_stats(
  '10000000-0000-0000-0000-000000000020'::uuid,
  'aaaaaaaa-0000-0000-0000-000000000001'::uuid,
  '2026-08-10T22:00:00Z'::timestamptz, 48  -- 01:00 local (Asia/Jerusalem, UTC+3) on 2026-08-11
);
select is(
  (select day from public.user_stats_daily
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and minutes = 5),
  '2026-08-11'::date,
  'a 22:00 UTC session buckets to the NEXT local day for a UTC+3 user'
);

-- ── 7. Milestone crossing: writes user_milestones + a rewards_history row +
--       folds bonus_points into user_stats.total_points ──────────────────
-- Fresh user; drive it to exactly 5 completed sessions to cross the first
-- milestone (sessions_5, 50 bonus points).
do $$
declare
  v_user uuid := 'aaaaaaaa-0000-0000-0000-000000000003';
  v_session uuid;
  i int;
begin
  insert into auth.users (id, email) values (v_user, 'milestone@test.dev');
  for i in 1..5 loop
    v_session := ('10000000-0000-0000-0000-00000000005' || i)::uuid;
    perform pg_temp.seed_participant(v_session, v_user, 'completed', 10, 10);
    perform public.apply_session_stats(
      v_session, v_user, ('2026-08-0' || i || 'T10:00:00Z')::timestamptz, 48
    );
  end loop;
end $$;

select is(
  (select count(*)::int from public.user_milestones um
     join public.milestones m on m.id = um.milestone_id
     where um.user_id = 'aaaaaaaa-0000-0000-0000-000000000003' and m.slug = 'sessions_5'),
  1, 'the 5-session milestone is crossed exactly once'
);
select is(
  (select points from public.rewards_history
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000003' and bonus_type = 'milestone'),
  50, 'crossing the milestone writes a rewards_history row for its bonus_points'
);
select is(
  (select total_points from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  100, -- 5 sessions x 10 base points + 50 milestone bonus
  'the milestone bonus is folded into user_stats.total_points'
);

-- ── 8. The core DoD invariant: total_points == sum(rewards_history.points) ──
select is(
  (select total_points from public.user_stats where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  (select coalesce(sum(points), 0)::int from public.rewards_history
     where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'DoD invariant: user_stats.total_points exactly equals the sum of that user''s rewards_history rows'
);

-- ── 9. stats_applied_at is actually set (the guard that made test 1's
--       second call return skipped) ────────────────────────────────────
select is(
  (select stats_applied_at from public.session_participants
     where session_id = '10000000-0000-0000-0000-000000000001'
       and user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  '2026-08-01T12:00:00Z'::timestamptz,
  'stats_applied_at is stamped with the passed-in finalized_at, not wall-clock now()'
);

-- ── 10. Function is Node-only (service_role), matching join_session() ──
set local role authenticated;
select throws_ok(
  $$ select public.apply_session_stats(
       '10000000-0000-0000-0000-000000000001'::uuid,
       'aaaaaaaa-0000-0000-0000-000000000001'::uuid, now(), 48
     ) $$,
  NULL,
  'authenticated cannot call apply_session_stats directly (service_role-only)'
);
reset role;

select * from finish();
rollback;
