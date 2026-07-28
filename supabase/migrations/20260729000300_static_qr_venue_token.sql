-- Phase 6 task 2: static QR = a venue-scoped, non-expiring token (owner
-- decision — see the plan's "Static QR" question). Unlike a session's
-- qr_token (15-minute TTL, regenerated per session), a venue's printed code
-- is meant to be printed once and never reprinted: it encodes the VENUE,
-- not any one session, and scanning it resolves to whichever static_qr
-- session is currently active there.

-- qr_token has no default -- unlike qr_token_issued_at, there's no sane
-- value to backfill (it must be a real signed token, minted by Node) --
-- but since this table has no production rows yet (Phase 6 is still
-- pre-release), adding it NOT NULL directly is safe rather than adding it
-- nullable and tightening later.
alter table public.venues
  add column qr_token text unique not null,
  add column qr_token_issued_at timestamptz not null default now();

-- A static_qr session's whole point is being tied to a venue -- unlike
-- dynamic_qr/solo, where venue_id is optional (Phase 6 task 1's ownership
-- check applies whenever venue_id is set, but only static_qr REQUIRES it).
alter table public.sessions
  add constraint chk_static_qr_has_venue
    check (type != 'static_qr' or venue_id is not null);

-- The DB-level guarantee behind "the venue's active session" being
-- unambiguous: without this, two concurrently-created static_qr sessions
-- at the same venue would leave join_venue_session() no principled way to
-- pick one. A partial unique index (not a CHECK) because the constraint
-- only applies to active sessions -- a venue's session history still has
-- many completed static_qr rows over time.
create unique index idx_one_active_static_qr_session_per_venue
  on public.sessions (venue_id)
  where status = 'active' and type = 'static_qr';

-- ============================================================
-- JOIN_VENUE_SESSION(): the venue-scoped counterpart to join_session().
-- Test-first contract: supabase/tests/join_venue_session_test.sql.
--
-- Resolving "which session is this venue's active one" and joining it are
-- one atomic statement, not two round trips from Node -- exactly
-- join_session()'s reasoning (TOCTOU: two devices scanning the same venue
-- QR at the same instant, right as the old session ends and before a new
-- one starts, must not both succeed against a session that's no longer
-- current). `select ... for update` locks the resolved session row so
-- concurrent joiners for the SAME venue serialize here, same as
-- join_session() does for a single session_id.
--
-- p_token is checked against the venue's CURRENT qr_token column, exactly
-- like join_session() checks its token against sessions.qr_token -- this
-- is what makes POST /venues/:id/qr/regenerate actually invalidate the old
-- printed code. Node's verifyVenueQrToken already proved the token's HMAC
-- signature is genuinely ours before ever calling this function (cheap,
-- reveals nothing about which venues exist for a garbage token); this
-- second check is for a token that signs correctly but names a venue
-- whose code has since been regenerated.
--
-- Returns a (outcome, session_id) row rather than plain text (unlike
-- join_session()) because Node doesn't know the session id ahead of time
-- here -- resolving it IS this function's job -- and the caller needs it
-- for the response and for attestation recording.
-- ============================================================
create function public.join_venue_session(
  p_venue_id uuid,
  p_token text,
  p_user_id uuid,
  p_max_participants int
) returns table(outcome text, session_id uuid)
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_venue_token text;
  v_session_id uuid;
  v_already_open boolean;
  v_open_count int;
begin
  -- RETURN QUERY does NOT exit the function on its own -- unlike a plain
  -- RETURN, it only appends rows to the result set and execution falls
  -- through to whatever comes next (caught by the real pgTAP run: a
  -- no_active_session case fell through into the join logic below and
  -- returned a SECOND, contradictory 'joined' row). Every early-exit
  -- branch below pairs RETURN QUERY with an explicit bare RETURN.
  select v.qr_token into v_venue_token
    from public.venues v
    where v.id = p_venue_id;

  if not found then
    return query select 'venue_not_found'::text, null::uuid;
    return;
  end if;

  if v_venue_token is distinct from p_token then
    return query select 'invalid_token'::text, null::uuid;
    return;
  end if;

  select s.id into v_session_id
    from public.sessions s
    where s.venue_id = p_venue_id and s.type = 'static_qr' and s.status = 'active'
    for update;

  if not found then
    return query select 'no_active_session'::text, null::uuid;
    return;
  end if;

  -- Every column reference below is qualified with the "spi" alias
  -- deliberately, not just for style: RETURNS TABLE(outcome, session_id)
  -- implicitly declares session_id as an OUT parameter in this function's
  -- own scope, which collides with session_presence_intervals.session_id
  -- if left unqualified -- Postgres raises "column reference session_id is
  -- ambiguous" (also caught by the real pgTAP run, not assumed).
  select exists (
    select 1 from public.session_presence_intervals spi
    where spi.session_id = v_session_id and spi.user_id = p_user_id and spi.left_at is null
  ) into v_already_open;

  if v_already_open then
    return query select 'already_joined'::text, v_session_id;
    return;
  end if;

  select count(*) into v_open_count
    from public.session_presence_intervals spi
    where spi.session_id = v_session_id and spi.left_at is null;

  if v_open_count >= p_max_participants then
    return query select 'at_capacity'::text, v_session_id;
    return;
  end if;

  insert into public.session_presence_intervals (session_id, user_id)
  values (v_session_id, p_user_id);

  return query select 'joined'::text, v_session_id;
  return;
end;
$$;

-- Node-only (service role) — never exposed to a signed-in client directly,
-- consistent with join_session()/rejoin_session().
revoke all on function public.join_venue_session(uuid, text, uuid, int) from public;
grant execute on function public.join_venue_session(uuid, text, uuid, int) to service_role;
