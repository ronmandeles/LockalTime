-- Phase 5.5 task 1 (Push Notification Infrastructure): device_tokens table
-- + users.locale column. Test-first contract:
-- supabase/tests/phase5_5_push_notifications_test.sql.

-- ============================================================
-- USERS: locale (Phase 5.5) -- the resolved app locale ('en'/'he'),
-- reported by the client (the same resolution i18n/resolve-device-locale.ts
-- already does for the app's own UI) so server-composed user-facing text
-- can be localized. This phase's streak-risk push (task 2) is the server's
-- first-ever user-facing string -- CLAUDE.md's i18n rule ("no hardcoded UI
-- strings ... both languages from day one") applies to it exactly as it
-- does to a screen. Display data, not money-equivalent -- same posture as
-- timezone; extends the same column-scoped grant rather than reopening a
-- table-wide UPDATE (which would reopen role, per the supabase-integration
-- skill's column-vs-table-grant note).
-- ============================================================
alter table public.users add column locale text;
revoke update on public.users from authenticated;
grant update (display_name, avatar_url, timezone, locale) on public.users to authenticated;

-- ============================================================
-- DEVICE_TOKENS (Phase 5.5 task 1, docs/RETENTION_STRATEGY.md §5) -- one
-- row per (user_id, platform): registering a fresh token upserts on this
-- constraint, so a reinstall replaces the old token instead of
-- accumulating duplicates (owner decision -- a second same-platform
-- device steals the notification slot, an accepted MVP limitation).
-- Registered directly by the client (not money-equivalent, same posture as
-- timezone/locale) -- service_role only needs SELECT, to read send targets
-- for the task 3 dispatch job. No service_role write grant: this table is
-- never written from Node.
-- ============================================================
create table public.device_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  token        text not null,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  unique (user_id, platform)
);

alter table public.device_tokens enable row level security;

create policy "users can read their own device tokens"
  on public.device_tokens for select
  using (user_id = auth.uid());
create policy "users can register their own device tokens"
  on public.device_tokens for insert
  with check (user_id = auth.uid());
create policy "users can update their own device tokens"
  on public.device_tokens for update
  using (user_id = auth.uid());

grant select, insert, update on public.device_tokens to authenticated;
grant select on public.device_tokens to service_role;
