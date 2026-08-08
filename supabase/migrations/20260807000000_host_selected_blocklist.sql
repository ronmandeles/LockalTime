-- Phase 9 task 1: the host names what a session blocks, instead of every
-- session blocking the same three hardcoded categories.
-- Plan: docs/BLOCKLIST_SELECTION_PLAN.md §3. Test-first contract:
-- supabase/tests/phase9_blocklist_test.sql.
--
-- Two array columns rather than JSONB or a join table: the list is always
-- read as a unit, never queried independently, and bounded at ~56 short
-- strings (6 categories + 50 packages, capped at the API boundary). Arrays
-- keep CHECK constraints and array operators available, which JSONB would
-- cost.
--
-- Both kinds of entry are plain strings, and that is the whole point: a
-- category name ('social') or a package name ('com.instagram.android')
-- means something on *every* member's device, where an opaque per-device
-- handle would not. Each device resolves the name against its own installed
-- apps at block time.

-- ============================================================
-- SESSIONS
-- ============================================================
alter table public.sessions
  add column blocked_categories text[] not null default '{social,games,entertainment}',
  add column blocked_packages   text[] not null default '{}';

comment on column public.sessions.blocked_categories is
  'Category names resolved on each member''s own device (Android ApplicationInfo.category / iOS ActivityCategoryToken). Covers apps installed later, unlike blocked_packages.';
comment on column public.sessions.blocked_packages is
  'Android package names, used as the cross-device identity for a specific app even on iOS (plan §6). Does NOT cover apps installed after the session starts.';

-- Backfill before the constraint, so existing rows survive it. The value is
-- the same as the column default and is not an arbitrary choice: it is
-- exactly what every pre-existing session actually enforced, from
-- apps/mobile/src/config/blocked-categories.ts.
update public.sessions set blocked_categories = '{social,games,entertainment}';

alter table public.sessions
  add constraint chk_blocked_categories_valid
    check (blocked_categories <@ array['social', 'games', 'entertainment', 'news', 'maps', 'productivity']::text[]),
  -- An accident-guard, not an anti-abuse control (plan §4): a host set on
  -- gaming it can pick one obscure app they don't have. It exists so nobody
  -- *accidentally* creates a session that blocks nothing while paying
  -- 1pt/min. Real anti-abuse would need server-verifiable enforcement,
  -- which neither platform offers.
  add constraint chk_blocklist_non_empty
    check (cardinality(blocked_categories) + cardinality(blocked_packages) > 0);

-- ============================================================
-- VENUES — an approved blocklist, granted out of band
-- ============================================================
-- A static_qr venue session seats up to VENUE_SESSION_MAX_PARTICIPANTS (200)
-- strangers and the business chooses what they block — nothing otherwise
-- stops a cafe blocking a competitor's app. So a venue's blocklist is
-- approved the same way Verified Host itself is granted today: a manual flag
-- in Supabase, no in-app application flow (ARCHITECTURE.md §10). The server
-- rejects any static_qr session whose blocklist falls outside these arrays.
--
-- The default is the same three categories, so a new business is useful
-- immediately and only needs the owner's attention if it wants to name
-- specific apps.
alter table public.venues
  add column approved_blocked_categories text[] not null default '{social,games,entertainment}',
  add column approved_blocked_packages   text[] not null default '{}';

update public.venues set approved_blocked_categories = '{social,games,entertainment}';

alter table public.venues
  add constraint chk_venue_approved_categories_valid
    check (approved_blocked_categories <@ array['social', 'games', 'entertainment', 'news', 'maps', 'productivity']::text[]);

-- No grant statements here on purpose. `grant select on table` is
-- table-wide and already covers columns added later, for both the
-- authenticated read policies and the Node API's service_role writes —
-- proven by the has_column_privilege assertions in the pgTAP file rather
-- than assumed, since a missing grant fails at runtime as
-- `permission denied`, never at migrate time.
--
-- Nothing new for the realtime publication either: public.sessions is
-- already published (20260726225600), and a published table streams its
-- whole row, new columns included.
