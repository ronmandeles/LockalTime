-- Phase 5.5 task 3: streak-risk claim function. Test-first contract:
-- supabase/tests/phase5_5_push_notifications_test.sql.

-- risk_notification_sent_for stores WHICH streak_grace_expires_at value was
-- last notified for (not a boolean) -- a fresh deadline (pushed forward by
-- a new session, or never notified before) is always eligible again, while
-- the SAME still-pending deadline is never re-claimed across repeated poll
-- ticks.
alter table public.user_streaks add column risk_notification_sent_for timestamptz;

-- Atomic claim: a naive "select candidates, then send, then mark sent" has
-- the same two-step race every other atomic function in this codebase
-- already guards against (join_session(), apply_session_stats()) -- here
-- the risk is re-notifying the same user on the next poll tick before the
-- "already notified" write lands. This single UPDATE ... RETURNING claims
-- and marks in one statement: a concurrent/overlapping tick's WHERE clause
-- no longer matches a row this statement already updated. No separate
-- "did they already have a session today" check is needed --
-- streak_grace_expires_at already IS that signal (a session pushes it past
-- the window automatically); an already-broken streak (current_streak = 0,
-- set by the existing expireStreaks() job) is naturally excluded too.
--
-- The table is aliased (us) and every column reference qualified --
-- RETURNS TABLE(user_id uuid) implicitly declares user_id as an OUT
-- parameter, which would otherwise collide with user_streaks.user_id
-- (the exact ambiguous-column-reference gotcha Phase 6's
-- join_venue_session() hit, caught by the real pgTAP run, not by
-- inspection).
create or replace function public.claim_streak_risk_notifications(
  p_now timestamptz,
  p_window_hours int
) returns table(user_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  return query
    update public.user_streaks as us
      set risk_notification_sent_for = us.streak_grace_expires_at
      where us.current_streak > 0
        and us.streak_grace_expires_at > p_now
        and us.streak_grace_expires_at <= p_now + (p_window_hours || ' hours')::interval
        and (us.risk_notification_sent_for is null
             or us.risk_notification_sent_for <> us.streak_grace_expires_at)
      returning us.user_id;
end;
$$;

revoke all on function public.claim_streak_risk_notifications(timestamptz, int) from public;
grant execute on function public.claim_streak_risk_notifications(timestamptz, int) to service_role;
