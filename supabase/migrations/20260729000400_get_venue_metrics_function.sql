-- Phase 6 task 5: B2B metrics (ARCHITECTURE.md §10) — a verified host's
-- read-only view of their own venue's activity. One SQL function rather
-- than several round trips from Node: PostgREST's query builder has no
-- native avg()/count() aggregate support the way a plain SQL function
-- does, and computing an average by fetching every row into Node and
-- averaging there would scale badly for a busy venue.
--
-- Deliberately a plain STABLE SQL function, not a row-locking PL/pgSQL one
-- like join_session()/join_venue_session(): this reads a snapshot for
-- display, it never decides or writes anything, so there is no
-- correctness reason to serialize concurrent callers against each other.
create function public.get_venue_metrics(
  p_venue_id uuid,
  p_window_start timestamptz
) returns table(
  concurrent_active_customers int,
  sessions_in_window int,
  avg_minutes_per_customer numeric
)
  language sql
  security definer
  set search_path = ''
  stable
as $$
  select
    (
      select count(*)::int
      from public.session_presence_intervals spi
      join public.sessions s on s.id = spi.session_id
      where s.venue_id = p_venue_id and s.status = 'active' and spi.left_at is null
    ),
    (
      select count(*)::int
      from public.sessions s
      where s.venue_id = p_venue_id and s.started_at >= p_window_start
    ),
    (
      select coalesce(avg(sp.total_minutes_present), 0)
      from public.session_participants sp
      join public.sessions s on s.id = sp.session_id
      where s.venue_id = p_venue_id and s.started_at >= p_window_start
    );
$$;

-- Node-only (service role) — a venue owner never queries this directly;
-- venues.router.ts's GET /:id/metrics enforces requireVerifiedHost +
-- ownership before ever calling it.
revoke all on function public.get_venue_metrics(uuid, timestamptz) from public;
grant execute on function public.get_venue_metrics(uuid, timestamptz) to service_role;
