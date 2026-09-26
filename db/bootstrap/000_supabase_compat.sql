-- ============================================================
-- Supabase compatibility bootstrap — TEMPORARY, deleted by task 10.2.
-- ============================================================
-- This file exists so the 22 migrations in supabase/migrations/ and the 15
-- pgTAP files in supabase/tests/ run on plain Postgres **completely
-- unchanged**, which is what makes task 10.1 a verifiable step on its own:
-- if the pgTAP suite is green here, the schema ports. Task 10.2 then replaces
-- auth.uid() with app.current_user_id() and deletes this file, so that when
-- the suite is run again the only suspect is the identity change.
--
-- Folding both into one step would leave a red suite with two candidate
-- causes and no way to tell them apart.
--
-- Everything below is idempotent: roles are cluster-wide, so this runs once
-- per database but repeatedly per cluster.
--
-- The exact Supabase surface the migrations depend on, measured rather than
-- assumed: 20 `grant ... to authenticated`, 27 `grant ... to service_role`,
-- 23 auth.uid() calls, 5 auth.users references, 2 `alter publication
-- supabase_realtime`, and zero `create extension`. Nothing else.

-- ── Data API roles ──────────────────────────────────────────────────
-- NOLOGIN: these are `SET ROLE` targets, never connection identities. The
-- pgTAP suite switches into `authenticated` 16 times to assert that RLS
-- denies what it should.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;

  -- BYPASSRLS mirrors the one property the Node API actually depends on:
  -- service_role sees through policies. Table privileges are still required
  -- on top of it, which is the trap supabase-integration documents twice.
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end
$$;

-- Membership so a non-superuser connection can still SET ROLE into these.
-- A superuser does not need it; the migration runner should not depend on
-- connecting as one.
do $$
begin
  execute format('grant anon, authenticated, service_role to %I', current_user);
end
$$;

-- ── The auth schema ─────────────────────────────────────────────────
create schema if not exists auth;

-- Only the three columns anything in this repo actually reads: public.users
-- has an FK to id, and handle_new_user() derives a display name from
-- raw_user_meta_data's full_name/name keys falling back to the email
-- local-part. Task 10.4 replaces this table with one the Node API owns.
create table if not exists auth.users (
  id                 uuid primary key default gen_random_uuid(),
  email              text,
  raw_user_meta_data jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now()
);

grant select, insert, update, delete on auth.users to service_role;

-- Reproduces Supabase's own auth.uid(): the request's user id, or NULL when
-- unauthenticated. Both claim shapes are read because the pgTAP suite sets
-- the JSON `request.jwt.claims` form (15 times) while PostgREST also sets the
-- flattened `request.jwt.claim.sub`. STABLE, not IMMUTABLE — it reads session
-- state, and marking it immutable would let the planner cache it across the
-- role switches the RLS tests depend on.
create or replace function auth.uid()
  returns uuid
  language sql
  stable
  as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
    )::uuid
  $fn$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- ── Realtime publication ────────────────────────────────────────────
-- Created empty; 20260726225600_create_sessions_core.sql adds public.sessions
-- and public.session_presence_intervals to it. Task 10.6 replaces the
-- publication with NOTIFY triggers, at which point this goes too.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
end
$$;
