-- Phase 6 tasks 8-9: device trust tier (merges backlog's "root/jailbreak
-- detection" and "Play Integrity/App Attest enforcement" into ONE
-- mechanism, per the plan's "Root detect" decision — Play Integrity's own
-- device verdict IS the trustworthy root signal; a client-side check can
-- be lied to by the very devices it targets, so no separate native probe
-- is added). Fail-open by construction: every column defaults to
-- 'trusted', and Node's ATTESTATION_ENFORCEMENT_ENABLED flag (constants.ts,
-- currently false) gates whether an 'unverified' tier ever actually
-- changes anything -- there is no real monitor-mode data yet to threshold
-- against (attestation-provider.ts still returns 'not_configured' for
-- every request), so this ships as built-but-inert machinery, not a claim
-- that enforcement is live.

alter table public.session_presence_intervals
  add column device_trust_tier text not null default 'trusted'
    check (device_trust_tier in ('trusted', 'unverified'));

alter table public.session_participants
  add column device_trust_tier text not null default 'trusted'
    check (device_trust_tier in ('trusted', 'unverified'));

-- Re-created (not touched in place -- the original migration is already
-- applied/committed) with one additional parameter, defaulted so every
-- existing call site keeps compiling unchanged. CREATE OR REPLACE only
-- replaces a function with the EXACT SAME parameter list -- adding a
-- parameter (even a defaulted one) creates a NEW, separate overload
-- instead, which left the original 4-arg function AND this 5-arg one
-- both resolvable for a plain 4-argument call ("function ... is not
-- unique", caught by the real pgTAP run against local Postgres, not
-- assumed). The old 4-arg overload must be dropped explicitly first.
drop function if exists public.apply_session_stats(uuid, uuid, timestamptz, int);

-- The only behavioral change: when p_device_trust_tier = 'unverified',
-- the streak-advance branch is skipped entirely (current_streak/
-- longest_streak/last_session_at/last_session_day/streak_grace_expires_at
-- all stay untouched) -- backlog's "exclude from bonus/streak only".
-- Lifetime stats (user_stats/user_stats_daily) and milestone crossings
-- are UNAFFECTED -- only bonus-earning (handled separately, in Node's
-- points/group-bonus.ts) and streak advancement are gated; base points
-- and session counts always accumulate regardless of device trust.
create or replace function public.apply_session_stats(
  p_session_id uuid,
  p_user_id uuid,
  p_finalized_at timestamptz,
  p_streak_grace_hours int,
  p_device_trust_tier text default 'trusted'
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
  select exit_reason, total_minutes_present, points_earned, stats_applied_at
    into v_exit_reason, v_minutes, v_points, v_already_applied
    from public.session_participants
    where session_id = p_session_id and user_id = p_user_id
    for update;

  if not found or v_already_applied is not null then
    return 'skipped';
  end if;

  select timezone into v_tz from public.users where id = p_user_id;
  begin
    v_local_day := (p_finalized_at at time zone coalesce(v_tz, 'UTC'))::date;
  exception when invalid_parameter_value then
    v_local_day := (p_finalized_at at time zone 'UTC')::date;
  end;

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

  insert into public.user_stats_daily (user_id, day, minutes, points, sessions)
    values (p_user_id, v_local_day, v_minutes, v_points, 1)
    on conflict (user_id, day) do update
      set minutes = public.user_stats_daily.minutes + excluded.minutes,
          points = public.user_stats_daily.points + excluded.points,
          sessions = public.user_stats_daily.sessions + excluded.sessions;

  -- Phase 6: an unverified device (with enforcement enabled -- Node only
  -- ever passes a real 'unverified' through when ATTESTATION_ENFORCEMENT_ENABLED
  -- is true) never advances the streak, but every other accumulation above
  -- already happened unconditionally.
  if p_device_trust_tier = 'unverified' then
    null;
  else
    insert into public.user_streaks (user_id) values (p_user_id)
      on conflict (user_id) do nothing;
    select current_streak, longest_streak, last_session_at, last_session_day
      into v_current, v_longest, v_last_session_at, v_last_session_day
      from public.user_streaks
      where user_id = p_user_id
      for update;

    if v_last_session_at is null then
      v_current := 1;
      v_longest := greatest(v_longest, 1);
      update public.user_streaks
        set current_streak = v_current, longest_streak = v_longest,
            last_session_at = p_finalized_at, last_session_day = v_local_day,
            streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
        where user_id = p_user_id;
    elsif p_finalized_at <= v_last_session_at then
      null;
    elsif v_local_day = v_last_session_day then
      update public.user_streaks
        set last_session_at = p_finalized_at,
            streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
        where user_id = p_user_id;
    elsif p_finalized_at - v_last_session_at <= (p_streak_grace_hours || ' hours')::interval then
      v_current := v_current + 1;
      v_longest := greatest(v_longest, v_current);
      update public.user_streaks
        set current_streak = v_current, longest_streak = v_longest,
            last_session_at = p_finalized_at, last_session_day = v_local_day,
            streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
        where user_id = p_user_id;
    else
      v_current := 1;
      v_longest := greatest(v_longest, 1);
      update public.user_streaks
        set current_streak = v_current, longest_streak = v_longest,
            last_session_at = p_finalized_at, last_session_day = v_local_day,
            streak_grace_expires_at = p_finalized_at + (p_streak_grace_hours || ' hours')::interval
        where user_id = p_user_id;
    end if;
  end if;

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

revoke all on function public.apply_session_stats(uuid, uuid, timestamptz, int, text) from public;
grant execute on function public.apply_session_stats(uuid, uuid, timestamptz, int, text) to service_role;
