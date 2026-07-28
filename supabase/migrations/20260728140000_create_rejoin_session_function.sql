-- public.rejoin_session(): token-free re-entry for a user who already
-- participated in this session at least once (any session_presence_intervals
-- row, open or closed). Test-first contract: supabase/tests/rejoin_session_test.sql.
--
-- Why this can't just be join_session() again: that function requires a
-- currently-valid qr_token (checked against the session's live qr_token
-- column, expiring after QR_TOKEN_TTL_MINUTES=15 — see
-- 20260726225700_create_join_session_function.sql). Screen 13's "Welcome
-- Back" flow (ARCHITECTURE.md §2/§4) exists specifically for gaps longer
-- than that — the 30-minute offline grace period, or the app being
-- relaunched after being killed — where re-scanning a QR code isn't
-- something the user should have to do to resume a session they never
-- deliberately left. Authorizing on "were you ever a participant here"
-- instead of a token closes that gap without weakening join_session()'s own
-- token check for first-time joins.
--
-- Same row-locking shape as join_session() and for the same reason: `select
-- ... for update` on the session row serializes concurrent callers for the
-- same session, so two rapid rejoin attempts (e.g. a flaky reconnect firing
-- twice) can't both pass the capacity check and both insert.
create function public.rejoin_session(
  p_session_id uuid,
  p_user_id uuid,
  p_max_participants int
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
  v_ever_participated boolean;
  v_already_open boolean;
  v_open_count int;
begin
  select status
    into v_status
    from public.sessions
    where id = p_session_id
    for update;

  if not found then
    return 'not_found';
  end if;

  if v_status not in ('pending', 'active') then
    return 'not_joinable';
  end if;

  select exists (
    select 1 from public.session_presence_intervals
    where session_id = p_session_id and user_id = p_user_id
  ) into v_ever_participated;

  if not v_ever_participated then
    return 'not_a_participant';
  end if;

  select exists (
    select 1 from public.session_presence_intervals
    where session_id = p_session_id and user_id = p_user_id and left_at is null
  ) into v_already_open;

  if v_already_open then
    return 'already_joined';
  end if;

  select count(*) into v_open_count
    from public.session_presence_intervals
    where session_id = p_session_id and left_at is null;

  if v_open_count >= p_max_participants then
    return 'at_capacity';
  end if;

  insert into public.session_presence_intervals (session_id, user_id)
  values (p_session_id, p_user_id);

  return 'joined';
end;
$$;

-- Node-only (service role) — never exposed to a signed-in client directly,
-- consistent with join_session() and every other session write.
revoke all on function public.rejoin_session(uuid, uuid, int) from public;
grant execute on function public.rejoin_session(uuid, uuid, int) to service_role;
