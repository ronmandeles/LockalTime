-- public.venues: display label for a static/business QR (no geolocation).
-- Test-first contract: supabase/tests/venues_test.sql.
-- Created ahead of the B2B application flow (Phase 6) because
-- public.sessions.venue_id FKs to it starting Phase 2 (dynamic/static QR
-- sessions can name a venue) — only the table lands now, not the B2B UI.

create table public.venues (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.users(id),
  name            text not null,
  address_label   text,        -- free-text display only, never geocoded
  created_at      timestamptz not null default now()
);

alter table public.venues enable row level security;

-- No sensitive data here — any authenticated user may read a venue's
-- display info (needed pre-join, e.g. Session Details for a static_qr
-- session). Writes are Node-API-only: no INSERT/UPDATE grant exists below,
-- so a direct client write fails on the underlying GRANT, not just a policy.
create policy "authenticated users can read venues"
  on public.venues for select
  using (true);

grant select on public.venues to authenticated;
