-- public.join_session(): the one atomic entry point for joining a session.
-- Test-first contract: supabase/tests/join_session_test.sql.
--
-- Why a DB function instead of Node doing "check then insert": two devices
-- joining the last open slot at the same instant would both read
-- "49 present" from a separate SELECT and both INSERT — a classic
-- time-of-check-to-time-of-use (TOCTOU) race. `select ... for update`
-- below takes a row lock on the session, so a second concurrent call for
-- the SAME session blocks until the first one's transaction commits —
-- collapsing "read the count, then decide, then write" into one atomic
-- step. Node calls this via the service-role client (RLS is irrelevant to
-- it either way, but SECURITY DEFINER + search_path='' mirrors the
-- hardening already used for handle_new_user()/is_session_participant()).
--
-- The token itself is checked TWICE, at two different layers, for two
-- different reasons: Node verifies the HMAC signature before ever calling
-- this function (cheap, reveals nothing about which sessions exist for a
-- garbage/tampered token). This function then compares the token string
-- against the session's CURRENT qr_token column — a token whose signature
-- still verifies but no longer matches the column (because the host
-- regenerated it) is correctly rejected here.
create function public.join_session(
  p_session_id uuid,
  p_user_id uuid,
  p_token text,
  p_max_participants int
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_status text;
  v_qr_token text;
  v_qr_expires_at timestamptz;
  v_already_open boolean;
  v_open_count int;
begin
  select status, qr_token, qr_expires_at
    into v_status, v_qr_token, v_qr_expires_at
    from public.sessions
    where id = p_session_id
    for update;

  if not found then
    return 'not_found';
  end if;

  if v_status not in ('pending', 'active') then
    return 'not_joinable';
  end if;

  if v_qr_token is distinct from p_token then
    return 'invalid_token';
  end if;

  if v_qr_expires_at is not null and v_qr_expires_at < now() then
    return 'expired';
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

-- Supports the open-interval capacity/idempotency lookups above.
create index idx_presence_open on public.session_presence_intervals(session_id)
  where left_at is null;

-- Node-only (service role) — never exposed to a signed-in client directly,
-- consistent with every other session write.
revoke all on function public.join_session(uuid, uuid, text, int) from public;
grant execute on function public.join_session(uuid, uuid, text, int) to service_role;
