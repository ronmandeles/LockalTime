-- Phase 6.5 task 2: friend graph schema + atomic request/accept functions.
-- Test-first contract: supabase/tests/phase6_5_social_test.sql.

-- ============================================================
-- FRIEND_REQUESTS -- ephemeral: a request is either accepted (converted
-- into a friendships row, see below) or declined/cancelled (just
-- deleted) -- never a persisted terminal status, so a declined request
-- never permanently blocks a future one.
-- ============================================================
create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

alter table public.friend_requests enable row level security;

create policy "users can read requests they sent or received"
  on public.friend_requests for select
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

create policy "users can send a friend request as themselves"
  on public.friend_requests for insert
  with check (auth.uid() = requester_id);

-- Covers both legitimate removal actions with one policy: the requester
-- cancelling their own outbound request, and the recipient declining an
-- inbound one.
create policy "either party can remove a pending request"
  on public.friend_requests for delete
  using (auth.uid() = requester_id or auth.uid() = recipient_id);

grant select, insert, delete on public.friend_requests to authenticated;
grant select on public.friend_requests to service_role;

-- ============================================================
-- FRIENDSHIPS -- a canonical ordering (user_id_a < user_id_b) guarantees
-- exactly one row per pair regardless of who sent the original request,
-- the same "push the no-duplicate-rows invariant into the schema"
-- principle as Phase 6's partial unique index on one active static_qr
-- session per venue.
-- ============================================================
create table public.friendships (
  user_id_a  uuid not null references public.users(id) on delete cascade,
  user_id_b  uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id_a < user_id_b),
  primary key (user_id_a, user_id_b)
);

alter table public.friendships enable row level security;

create policy "users can read their own friendships"
  on public.friendships for select
  using (auth.uid() = user_id_a or auth.uid() = user_id_b);

-- Unfriending is a direct client-side RLS delete -- no Node round trip,
-- no cross-row invariant to protect on removal.
create policy "either party can remove a friendship"
  on public.friendships for delete
  using (auth.uid() = user_id_a or auth.uid() = user_id_b);

-- No insert/update policy for authenticated -- a friendship is only ever
-- created by the two functions below (SECURITY DEFINER, runs as the
-- table owner).
grant select, delete on public.friendships to authenticated;
grant select on public.friendships to service_role;

-- ============================================================
-- SEND_FRIEND_REQUEST(): Node-only. Mirrors join_session()'s "Node passes
-- the already-authenticated caller id explicitly, never trusts a
-- client-supplied one" shape. A mutual double-request (both users request
-- each other before either responds) auto-resolves to a friendship
-- immediately, the same behavior a real Instagram/Facebook-style request
-- system has -- "you both asked" needs no separate accept step.
--
-- Deletes any pending request in EITHER direction before inserting a
-- friendship, not just the one direction this call happened to discover:
-- two truly concurrent opposite-direction calls could each insert their
-- own request row before either sees the other's (a real race, not just
-- a theoretical one -- closing it is why this isn't a plain two-step
-- Node-orchestrated write). The friendship insert is itself wrapped
-- against unique_violation and treated as success: if a concurrent call
-- already created the same (v_a, v_b) row, the outcome ('friends') is
-- correct either way.
-- ============================================================
create function public.send_friend_request(
  p_requester_id uuid, p_recipient_id uuid
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_a uuid;
  v_b uuid;
  v_reverse_exists boolean;
begin
  if p_requester_id = p_recipient_id then
    return 'invalid_recipient';
  end if;

  v_a := least(p_requester_id, p_recipient_id);
  v_b := greatest(p_requester_id, p_recipient_id);

  if exists (
    select 1 from public.friendships where user_id_a = v_a and user_id_b = v_b
  ) then
    return 'already_friends';
  end if;

  if exists (
    select 1 from public.friend_requests
     where requester_id = p_requester_id and recipient_id = p_recipient_id
  ) then
    return 'already_requested';
  end if;

  select true into v_reverse_exists
    from public.friend_requests
   where requester_id = p_recipient_id and recipient_id = p_requester_id
   for update;

  if v_reverse_exists then
    delete from public.friend_requests
     where (requester_id = v_a and recipient_id = v_b)
        or (requester_id = v_b and recipient_id = v_a);
    begin
      insert into public.friendships (user_id_a, user_id_b) values (v_a, v_b);
    exception when unique_violation then
      null; -- a concurrent call already created it -- same outcome either way.
    end;
    return 'friends';
  end if;

  insert into public.friend_requests (requester_id, recipient_id)
    values (p_requester_id, p_recipient_id);
  return 'requested';
end;
$$;

revoke all on function public.send_friend_request(uuid, uuid) from public;
grant execute on function public.send_friend_request(uuid, uuid) to service_role;

-- ============================================================
-- RESPOND_TO_FRIEND_REQUEST(): Node-only, same posture. Filters to a
-- request where p_recipient_id actually IS the recipient -- a non-
-- recipient gets 'not_found', not a permissions error, so responding to
-- someone else's request never confirms it exists at all.
-- ============================================================
create function public.respond_to_friend_request(
  p_recipient_id uuid, p_request_id uuid, p_accept boolean
) returns text
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  v_requester_id uuid;
  v_a uuid;
  v_b uuid;
begin
  select requester_id into v_requester_id
    from public.friend_requests
   where id = p_request_id and recipient_id = p_recipient_id
   for update;

  if v_requester_id is null then
    return 'not_found';
  end if;

  v_a := least(v_requester_id, p_recipient_id);
  v_b := greatest(v_requester_id, p_recipient_id);

  delete from public.friend_requests
   where (requester_id = v_a and recipient_id = v_b)
      or (requester_id = v_b and recipient_id = v_a);

  if not p_accept then
    return 'declined';
  end if;

  begin
    insert into public.friendships (user_id_a, user_id_b) values (v_a, v_b);
  exception when unique_violation then
    null; -- a concurrent send_friend_request() already created it.
  end;
  return 'accepted';
end;
$$;

revoke all on function public.respond_to_friend_request(uuid, uuid, boolean) from public;
grant execute on function public.respond_to_friend_request(uuid, uuid, boolean) to service_role;
