-- Phase 6 task 1: venues gets a real create/list API (venues.router.ts) --
-- the live gap this closes: the original venues migration granted
-- `select` to `authenticated` only, with NO `service_role` grant at all
-- (.claude/skills/supabase-integration/SKILL.md's rule -- service_role
-- bypasses RLS POLICIES, never table GRANTs). The Node API's first
-- `insert`/`update` against this table would have hit
-- "permission denied for table venues", the exact trap
-- create_sessions_core.sql already documents for a different table.

grant select, insert, update on public.venues to service_role;

-- Tighten the read policy from `using (true)` (any authenticated user could
-- read any venue's owner_id) to owner-only. Nothing in the app depends on
-- the wide policy: a joining participant learns a venue's display name
-- through the server-computed session-preview endpoint (Phase 6 task 4),
-- not a direct client read -- so this is a pure hardening tighten, not a
-- feature removal.
drop policy "authenticated users can read venues" on public.venues;

create policy "owners can read their own venues"
  on public.venues for select
  using (owner_id = auth.uid());
