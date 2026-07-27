-- Phase 4 task 7 (sweep worker): host migration needs to close the old
-- host's session_host_assignments row (set unassigned_at) as well as
-- insert the new one -- the original Phase 2 migration only granted
-- service_role select+insert on this table, not update. Same category of
-- gap documented in .claude/skills/supabase-integration/SKILL.md: a new
-- table/verb combination gets zero Data API privileges by default, found
-- the hard way (again) via a real integration test
-- (apps/server/integration/session-sweep.integration.test.ts) hitting
-- "permission denied for table session_host_assignments".
grant update on public.session_host_assignments to service_role;
