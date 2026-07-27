-- Core Phase 2 session schema: sessions, session_host_assignments,
-- session_presence_intervals, session_participants, device_attestations.
-- Test-first contract: supabase/tests/sessions_test.sql.
-- Shape per docs/DATABASE.md. Design note (docs/DATABASE.md): presence is
-- stored as durable join/leave INTERVALS, not a running minutes counter --
-- the Phase 4 Group Bonus algorithm has to replay overlapping-presence
-- history after the fact, which a counter would have already discarded.

-- ============================================================
-- SESSIONS
-- ============================================================
create table public.sessions (
  id                       uuid primary key default gen_random_uuid(),
  host_id                  uuid not null references public.users(id),
  venue_id                 uuid references public.venues(id),
  type                     text not null
                             check (type in ('solo', 'dynamic_qr', 'static_qr')),
  status                   text not null default 'pending'
                             check (status in ('pending', 'active', 'completed', 'cancelled')),
  duration_mode            text not null default 'fixed'
                             check (duration_mode in ('fixed', 'open_ended')),
  planned_duration_minutes int check (planned_duration_minutes > 0),
  actual_duration_minutes  int,
  qr_token                 text unique,          -- signed by Node, null for solo
  qr_expires_at            timestamptz,
  started_at               timestamptz,
  ended_at                 timestamptz,
  ended_by                 uuid references public.users(id),
  end_reason               text
                             check (end_reason in ('host_ended', 'planned_duration_reached')),
  created_at               timestamptz not null default now(),

  constraint chk_dynamic_qr_has_token
    check (type = 'solo' or qr_token is not null),
  constraint chk_fixed_has_duration
    check (duration_mode = 'open_ended' or planned_duration_minutes is not null)
);

create index idx_sessions_status on public.sessions(status) where status in ('pending', 'active');
create index idx_sessions_host on public.sessions(host_id);

-- ============================================================
-- HOST ASSIGNMENT AUDIT (initial host + every migration)
-- ============================================================
create table public.session_host_assignments (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  user_id       uuid not null references public.users(id),
  assigned_at   timestamptz not null default now(),
  unassigned_at timestamptz,
  reason        text not null check (reason in ('initial_host', 'migration'))
);

create index idx_host_assignments_session on public.session_host_assignments(session_id);

-- ============================================================
-- PRESENCE INTERVALS (durable join/leave history — drives bonus math + rejoin)
-- ============================================================
create table public.session_presence_intervals (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references public.sessions(id) on delete cascade,
  user_id           uuid not null references public.users(id),
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,      -- null while still connected
  disconnect_reason text
                      check (disconnect_reason in ('emergency_exit', 'involuntary_disconnect', 'session_ended'))
);

create index idx_presence_session on public.session_presence_intervals(session_id);
create index idx_presence_user on public.session_presence_intervals(user_id);

-- ============================================================
-- SESSION PARTICIPANTS (per-user summary row, computed at session close)
-- ============================================================
create table public.session_participants (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references public.sessions(id) on delete cascade,
  user_id                   uuid not null references public.users(id),
  is_host                   boolean not null default false,
  total_minutes_present     int not null default 0,
  exit_reason               text check (exit_reason in ('completed', 'emergency_exit')),
  group_bonus_earned        boolean not null default false,
  completion_bonus_earned   boolean not null default false,
  points_earned             int not null default 0,

  unique (session_id, user_id)
);

create index idx_participants_session on public.session_participants(session_id);
create index idx_participants_user on public.session_participants(user_id);

-- ============================================================
-- DEVICE ATTESTATIONS (Play Integrity / App Attest — monitor-mode only,
-- ARCHITECTURE.md §8 item 8; queried by Node/analysis, never by a client)
-- ============================================================
create table public.device_attestations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id),
  session_id   uuid references public.sessions(id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  action       text not null check (action in ('create', 'join')),
  verdict      text not null,
  raw_response jsonb not null,   -- full provider payload, for Phase 6 re-analysis
  created_at   timestamptz not null default now()
);

create index idx_attestations_session on public.device_attestations(session_id);
create index idx_attestations_user on public.device_attestations(user_id);

-- ============================================================
-- RLS helper: is the current authenticated user allowed to see this
-- session (host, or has ever joined it)? SECURITY DEFINER + search_path
-- pinned to '' (same hardening as handle_new_user()) so the function body
-- runs with the owner's privileges rather than the caller's — otherwise a
-- SECURITY INVOKER version querying public.sessions from inside a
-- public.sessions read policy would recurse into that same policy.
-- ============================================================
create function public.is_session_participant(p_session_id uuid)
  returns boolean
  language sql
  security definer
  set search_path = ''
  stable
as $$
  select exists (
    select 1 from public.session_presence_intervals
    where session_id = p_session_id and user_id = auth.uid()
  )
  or exists (
    select 1 from public.sessions
    where id = p_session_id and host_id = auth.uid()
  );
$$;

alter table public.sessions enable row level security;
alter table public.session_host_assignments enable row level security;
alter table public.session_presence_intervals enable row level security;
alter table public.session_participants enable row level security;
alter table public.device_attestations enable row level security;

-- Read-only for a session's own participants; every write (including the
-- very first insert that creates a session) goes through the Node API
-- under the service role, which bypasses RLS entirely — the money-
-- equivalent rule (CLAUDE.md) expressed as a database privilege rather
-- than a convention someone has to remember.
create policy "participants can read their session"
  on public.sessions for select
  using (public.is_session_participant(id));

create policy "participants can read host assignment history"
  on public.session_host_assignments for select
  using (public.is_session_participant(session_id));

create policy "participants can read presence intervals"
  on public.session_presence_intervals for select
  using (public.is_session_participant(session_id));

create policy "participants can read session participant rows"
  on public.session_participants for select
  using (public.is_session_participant(session_id));

-- device_attestations has no policy and no CLIENT grant at all: it is
-- never read by a client, only by the Node API (service role) and by
-- direct SQL analysis ahead of Phase 6's enforcement thresholds.

grant select on public.sessions to authenticated;
grant select on public.session_host_assignments to authenticated;
grant select on public.session_presence_intervals to authenticated;
grant select on public.session_participants to authenticated;

-- service_role bypasses RLS POLICIES, but — surprising, and the reason
-- this block exists — that does NOT mean it bypasses GRANTS. Current
-- Supabase CLI/platform default is "new entities are NOT auto-exposed to
-- ANY Data API role" (see supabase/config.toml's [api] auto_expose_new_tables
-- note), service_role included. Discovered by a real integration test
-- against the local stack hitting `permission denied for table sessions`
-- on the Node API's own service-role insert — every table the Node API
-- writes to needs an explicit grant here, or every write 500s regardless
-- of application code being correct.
grant select, insert, update on public.sessions to service_role;
grant select, insert on public.session_host_assignments to service_role;
grant select, insert, update on public.session_presence_intervals to service_role;
grant select, insert, update on public.session_participants to service_role;
grant select, insert on public.device_attestations to service_role;

-- Postgres Changes (CDC) is the only trusted realtime channel
-- (ARCHITECTURE.md §5) — without adding a table to this publication,
-- clients subscribed to session:{id} receive no change events for it at
-- all. Presence/Broadcast need no publication entry — they're server/
-- client-driven, not backed by table writes.
alter publication supabase_realtime add table public.sessions;
alter publication supabase_realtime add table public.session_presence_intervals;
