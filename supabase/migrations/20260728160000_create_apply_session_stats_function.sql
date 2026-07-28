-- public.apply_session_stats(): the single atomic entry point that
-- accumulates one finalized session_participants row into
-- user_stats / user_stats_daily / user_streaks / user_milestones (+ a
-- rewards_history row for any milestone crossed). Test-first contract:
-- supabase/tests/apply_session_stats_test.sql. Called from Node's
-- end-session.ts (per participant, at session end) and
-- finalize-emergency-exit.ts (inline, at emergency exit) -- Phase 5 task 4.
--
-- Why a DB function instead of Node doing "read streak, compute, write
-- streak": there are two independent Node call sites, either of which can
-- race the sweep worker or each other for the same user across different
-- sessions. A Node-side read-modify-write has a lost-update window no
-- amount of application-level care closes. This function does the whole
-- read-decide-write cycle for one participant under row locks inside a
-- single transaction -- same precedent as join_session()/rejoin_session().
--
-- Lock ordering (to make concurrent calls serialize rather than deadlock):
-- session_participants row -> user_stats row -> user_streaks row, always
-- in that order, every call. No other code path takes more than one of
-- these locks at once except the Phase 5 task 5 streak-expiry job, which
-- only ever touches user_streaks alone.
create function public.apply_session_stats(
  p_session_id uuid,
  p_user_id uuid,
  p_finalized_at timestamptz,
  p_streak_grace_hours int
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_exit_reason text;
  v_minutes int;
  v_points int;
  v_already_applied timestamptz;
  v_tz text;
  v_local_day date;
  v_last_session_at timestamptz;
  v_last_session_day date;
  v_current int;
  v_longest int;
  v_total_sessions int;
  v_milestone_row record;
  v_bonus_points int;
begin
  -- Exactly-once guard. Locks the participant row so two callers racing
  -- the SAME (session_id, user_id) can't both pass this check -- the
  -- second blocks here until the first's transaction commits and sees
  -- stats_applied_at already set.
  select exit_reason, total_minutes_present, points_earned, stats_applied_at
    into v_exit_reason, v_minutes, v_points, v_already_applied
    from public.session_participants
    where session_id = p_session_id and user_id = p_user_id
    for update;

  if not found or v_already_applied is not null then
    return 'skipped';
  end if;

  -- Resolve the participant's LOCAL day for user_stats_daily bucketing. A
  -- garbage/unrecognized users.timezone (bad client-reported IANA zone)
  -- must never abort finalization -- falls back to UTC rather than let
  -- one corrupt row 500 the whole session-end request.
  select timezone into v_tz from public.users where id = p_user_id;
  begin
    v_local_day := (p_finalized_at at time zone coalesce(v_tz, 'UTC'))::date;
  exception when invalid_parameter_value then
    v_local_day := (p_finalized_at at time zone 'UTC')::date;
  end;

  -- Lifetime aggregates. Lazily creates the row on a user's first-ever
  -- contributing session (mirrors join_session()'s lazy-row pattern).
  insert into public.user_stats (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  update public.user_stats
    set total_minutes = total_minutes + v_minutes,
        total_points = total_points + v_points,
        sessions_completed = sessions_completed
          + case when v_exit_reason = 'completed' then 1 else 0 end,
        sessions_emergency_exit = sessions_emergency_exit
          + case when v_exit_reason = 'emergency_exit' then 1 else 0 end,
        sessions_disconnected = sessions_disconnected
          + case when v_exit_reason = 'disconnected' then 1 else 0 end,
        updated_at = p_finalized_at
    where user_id = p_user_id
    returning sessions_completed + sessions_emergency_exit + sessions_disconnected
      into v_total_sessions;

  -- Daily time series (Stats screen 7-day chart). Every finalized session
  -- counts here, regardless of exit_reason -- same "any session with
  -- presence" rule the streak below uses.
  insert into public.user_stats_daily (user_id, day, minutes, points, sessions)
    values (p_user_id, v_local_day, v_minutes, v_points, 1)
    on conflict (user_id, day) do update
      set minutes = public.user_stats_daily.minutes + excluded.minutes,
          points = public.user_stats_daily.points + excluded.points,
          sessions = public.user_stats_daily.sessions + excluded.sessions;

  -- Streak. Lazily creates the row, then locks it to read-and-branch.
  insert into public.user_streaks (user_id) values (p_user_id)
    on conflict (user_id) do nothing;
  select current_streak, longest_streak, last_session_at, last_session_day
    into v_current, v_longest, v_last_session_at, v_last_session_day
    from public.user_streaks
    where user_id = p_user_id
    for update;

  if v_last_session_at is null then
    -- First-ever contributing session.
    v_current := 1;
    v_longest := greatest(v_longest, 1);
    update public.user_streaks
      set current_streak = v_current, longest_streak = v_longest,
          last_session_at = p_finalized_at, last_session_day = v_local_day,
          streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
      where user_id = p_user_id;
  elsif p_finalized_at <= v_last_session_at then
    -- Out-of-order: an older session finalized after a newer one already
    -- advanced the streak (e.g. the sweep worker closing a stale interval
    -- for a participant who has since started a fresh session elsewhere).
    -- Stats above still accumulated; the streak itself must never move
    -- backwards in time, so it's left completely untouched.
    null;
  elsif v_local_day = v_last_session_day then
    -- A second qualifying session on the same local day doesn't
    -- double-count the streak, but does push the grace window forward
    -- from this later activity.
    update public.user_streaks
      set last_session_at = p_finalized_at,
          streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
      where user_id = p_user_id;
  elsif p_finalized_at - v_last_session_at <= (p_streak_grace_hours || ' hours')::interval then
    -- Within grace, a new day: the streak extends.
    v_current := v_current + 1;
    v_longest := greatest(v_longest, v_current);
    update public.user_streaks
      set current_streak = v_current, longest_streak = v_longest,
          last_session_at = p_finalized_at, last_session_day = v_local_day,
          streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
      where user_id = p_user_id;
  else
    -- Grace exceeded: broken and restarted.
    v_current := 1;
    v_longest := greatest(v_longest, 1);
    update public.user_streaks
      set current_streak = v_current, longest_streak = v_longest,
          last_session_at = p_finalized_at, last_session_day = v_local_day,
          streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
      where user_id = p_user_id;
  end if;

  -- Milestone crossing: set-based and naturally idempotent via ON
  -- CONFLICT DO NOTHING (a user already past a threshold never re-crosses
  -- it). Looping over the RETURNING set correctly handles crossing more
  -- than one tier in a single session (e.g. seeded/backfilled data).
  for v_milestone_row in
    insert into public.user_milestones (user_id, milestone_id)
      select p_user_id, m.id from public.milestones m
      where m.sessions_required <= v_total_sessions
      on conflict (user_id, milestone_id) do nothing
      returning milestone_id
  loop
    select bonus_points into v_bonus_points
      from public.milestones where id = v_milestone_row.milestone_id;

    insert into public.rewards_history (user_id, session_id, points, bonus_type)
      values (p_user_id, p_session_id, v_bonus_points, 'milestone');

    -- Keeps the DoD invariant (user_stats.total_points ==
    -- sum(rewards_history.points)) true by construction -- the milestone
    -- bonus is added to the same aggregate the base/bonus points above
    -- just updated, in the same transaction as its rewards_history row.
    update public.user_stats
      set total_points = total_points + v_bonus_points
      where user_id = p_user_id;

    insert into public.user_stats_daily (user_id, day, points)
      values (p_user_id, v_local_day, v_bonus_points)
      on conflict (user_id, day) do update
        set points = public.user_stats_daily.points + excluded.points;
  end loop;

  update public.session_participants
    set stats_applied_at = p_finalized_at
    where session_id = p_session_id and user_id = p_user_id;

  return 'applied';
end;
$$;

-- Node-only (service role) -- never exposed to a signed-in client
-- directly, consistent with join_session()/rejoin_session().
revoke all on function public.apply_session_stats(uuid, uuid, timestamptz, int) from public;
grant execute on function public.apply_session_stats(uuid, uuid, timestamptz, int) to service_role;
