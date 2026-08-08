# Lockal Time — Database Schema

Status: planning blueprint, except the tables implemented so far. `users` — implemented (`supabase/migrations/20260718015352_create_users.sql`), migrated to both local and production (`LockalTime`), pgTAP-verified (`supabase/tests/users_test.sql`). The signup trigger (`supabase/migrations/20260718192504_create_users_signup_trigger.sql`) is implemented and pgTAP-verified locally (`supabase/tests/users_trigger_test.sql`); production push pending (done manually by the user per `CLAUDE.md`). **Phase 2 task 2.1** (`supabase/migrations/20260726225500_create_venues.sql`, `20260726225600_create_sessions_core.sql`): `venues`, `sessions`, `session_host_assignments`, `session_presence_intervals`, `session_participants`, `device_attestations` implemented and pgTAP-verified locally. **Phase 2 task 2.3** (`supabase/migrations/20260726225700_create_join_session_function.sql`): `join_session()` atomic-join RPC. **Phase 4 task 2** (`supabase/migrations/20260728120000_phase4_lifecycle_and_rewards.sql`): `rewards_history` created (RLS: own rows only); `sessions.end_reason` gains `force_terminated`; `session_participants.exit_reason` gains `disconnected`; `session_presence_intervals` gains `blocker_ready_at`. **Phase 4 task 7** (`supabase/migrations/20260728130000_grant_host_assignments_update.sql`): `session_host_assignments` gains a `service_role` `UPDATE` grant — the original Phase 2 migration only granted `select, insert`, missed until the sweep worker's real integration test tried to close a migrated-away host's assignment row and hit `permission denied`. **Phase 4 task 12** (`supabase/migrations/20260728140000_create_rejoin_session_function.sql`): `rejoin_session()`, the token-free counterpart to `join_session()` for Screen 13's Welcome Back rejoin. **Phase 5 task 2** (`supabase/migrations/20260728150000_phase5_gamification_and_stats.sql`): `user_streaks`, `user_stats`, `user_stats_daily`, `milestones` (seeded, 6 tiers), `user_milestones` created; `users.timezone` and `session_participants.stats_applied_at` added. Three deliberate deviations from this file's original blueprint below it (see the "Bonus Computation"/"Gamification" sections for why): `user_stats.sessions_disconnected`, `user_streaks.last_session_day`, `milestones.slug`. 108/108 pgTAP passing (adds `supabase/tests/phase5_gamification_test.sql`, 28 new), plus a real integration suite (`apps/server/integration/sessions.integration.test.ts`) covering create→join→leave, RLS, true concurrent-join-at-capacity, and create→join→disconnect→rejoin→end (proving the disconnect gap disqualifies the Completion Bonus while base points are still credited — the Phase 4 DoD's disconnect-and-rejoin line) against the live local stack; production push pending (manual, per `CLAUDE.md`). **Phase 6** (five migrations, `20260729000000` through `20260729000500`): `grant select on public.users to service_role` (the role-authorization primitive's read path); venues gets its missing `service_role` grant plus a tightened owner-only read policy; `venues.qr_token`/`qr_token_issued_at` (the static-QR venue token) + `chk_static_qr_has_venue` + a partial unique index (one active `static_qr` session per venue) + `public.join_venue_session()`; `public.get_venue_metrics()` (the B2B dashboard's data source); `session_presence_intervals`/`session_participants.device_trust_tier` + `apply_session_stats()` re-created with a 5th `p_device_trust_tier` parameter (see "Stats/Streak/Milestone Accumulation" below). 154/154 pgTAP passing (adds `supabase/tests/phase6_hardening_test.sql` + `join_venue_session_test.sql`, 26 new), plus 17 real integration tests against the live local stack. **Phase 5.5** (two migrations, `20260730000000`-`20260730000100`): `device_tokens` (one row per `(user_id, platform)`, `service_role` select-only — registration is always a direct authenticated client write) + `users.locale` (extends the existing column-scoped `update` grant alongside `timezone`, needed so the server's first-ever user-facing text — the streak-risk push — can be localized); `user_streaks.risk_notification_sent_for` + `public.claim_streak_risk_notifications()` (the streak-risk dispatch job's atomic claim function, same `UPDATE ... RETURNING` pattern as `join_session()`). 175/175 pgTAP passing (adds `supabase/tests/phase5_5_push_notifications_test.sql`, 21 new), plus 4 real integration tests against the live local stack. **Phase 6.5** (two migrations, `20260731000000`-`20260731000100`): `users.username` (unique, not null, auto-generated at signup by a re-created `handle_new_user()`) + `friend_requests` (ephemeral — accepted or declined, never a persisted terminal status) + `friendships` (canonical `user_id_a < user_id_b` ordering) + `public.send_friend_request()`/`public.respond_to_friend_request()` (atomic Node-only functions). 209/209 pgTAP passing (adds `supabase/tests/phase6_5_social_test.sql`, 29 new; `supabase/tests/users_trigger_test.sql` gains 5 more for username generation), plus 4 real integration tests against the live local stack. **Phase 7** (`supabase/migrations/20260801000000_account_deletion_cascades.sql`): every bare `references public.users(id)`/`references public.sessions(id)` FK left at Postgres's default `NO ACTION` gets a real `ON DELETE` action — before this migration, deleting the account of anyone who had ever hosted/joined a session or owned a venue failed outright with a foreign-key violation, i.e. account deletion only worked for a brand-new user with no history. `sessions.host_id`, `session_host_assignments.user_id`, `session_presence_intervals.user_id`, `session_participants.user_id`, and `device_attestations.user_id` all gain `ON DELETE CASCADE`; `sessions.ended_by` and `venues.owner_id` (made nullable) gain `ON DELETE SET NULL`; `rewards_history.user_id` cascades but `rewards_history.session_id` is deliberately `SET NULL` rather than cascade, so another participant's own earned-points receipt survives the session's host deleting their account. 224/224 pgTAP passing (adds `supabase/tests/phase7_release_prep_test.sql`, 15 new — a full delete-a-participant-then-delete-the-host scenario against real rows, not just constraint definitions), plus a real integration test (`apps/server/integration/account-deletion.integration.test.ts`) proving `DELETE /account` actually removes the `auth.users` row end to end and stays idempotent on retry. `20260801000100_users_tos_acceptance.sql`: `users.tos_accepted_at` (nullable — existing users are grandfathered as null, not backfilled), granted to `authenticated` for a direct client write (same posture as `timezone`/`locale` — not money-equivalent, not a security boundary) rather than a Node endpoint. This is the consolidated, final-for-now schema reflecting every decision made during architecture planning. Update this file whenever a migration changes the shape of the data — `supabase/migrations/` is the executable source of truth, this file is the human-readable explanation of *why* it looks the way it does.

Note on RLS in production: a table's RLS policies alone don't grant access — Postgres privileges (`GRANT`) must exist too, and new tables get none by default for `anon`/`authenticated` **or `service_role`** (confirmed against the real local stack in Phase 2 task 2.3 — the Node API's own service-role writes 500'd until `service_role` got explicit grants too). See `.claude/skills/supabase-integration/SKILL.md` for the pattern (table-wide `SELECT`, column-scoped `UPDATE` to exclude fields like `role`, and a `service_role` grant for every table the Node API writes to).

## Design Principles

- Money-equivalent fields (points, bonuses, QR tokens) are only ever written by the Node.js API, never directly by a client under RLS.
- Presence/liveness (`session_presence_intervals`) is stored durably in Postgres, *not* left to Supabase Realtime Presence alone, because the Group/Completion Bonus algorithms need to replay exact join/leave history after the fact — Presence is ephemeral and only good for live host-migration detection, not for bonus math.
- No geolocation is collected anywhere in this schema. `venues` is a display label only.

## Schema

```sql
create extension if not exists pgcrypto;

-- ============================================================
-- USERS (extends Supabase auth.users)
-- ============================================================
create table public.users (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text not null,
  username        text not null unique,  -- Phase 6.5: auto-generated at
                                -- signup from display_name (lowercase
                                -- alphanumerics, numeric-suffixed on
                                -- collision) -- the search-by-username
                                -- discovery mechanism (owner decision)
                                -- needs every user to have one from the
                                -- moment they exist
  avatar_url      text,
  role            text not null default 'user'
                    check (role in ('user', 'verified_host', 'admin')),
  timezone        text,        -- Phase 5: IANA zone name, client-reported,
                                -- used to bucket sessions into the
                                -- participant's LOCAL day (see
                                -- apply_session_stats() below)
  locale          text,        -- Phase 5.5: 'en'/'he', client-reported (same
                                -- resolution the app's own UI uses), so
                                -- server-composed notifications (the
                                -- streak-risk push) can be localized
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Signup trigger: GoTrue inserts into auth.users on signup for all three
-- providers (email OTP, Google/Apple via signInWithIdToken), so an AFTER
-- INSERT trigger there is the single choke point that guarantees a profile
-- row always exists. display_name derivation, first non-empty wins:
--   raw_user_meta_data->>'full_name'  (Google/Apple id-token shape)
--   → raw_user_meta_data->>'name'     (variant key some providers use)
--   → email local-part                (email OTP carries no name metadata;
--                                      user-editable later via the
--                                      column-scoped UPDATE grant)
--   → 'user'                          (final guard — display_name is NOT NULL
--                                      and must never abort the auth insert)
-- SECURITY DEFINER (owner postgres) because the insert runs under
-- supabase_auth_admin, which has no privileges on public.users; search_path
-- is pinned to '' so the definer function can't be hijacked. ON CONFLICT (id)
-- DO NOTHING so a pre-existing profile row never errors the signup itself.
create function public.handle_new_user()
  returns trigger language plpgsql security definer set search_path = '' ...;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- VENUES (display label for static/business QR — no geolocation)
-- ============================================================
create table public.venues (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid references public.users(id) on delete set null,
                    -- Phase 7: made nullable, ON DELETE SET NULL (was `not
                    -- null references ... ` with no delete action, which
                    -- blocked account deletion for any venue owner). A venue
                    -- is a shared B2B asset other users' sessions may still
                    -- reference (sessions.venue_id has no cascade of its
                    -- own) -- it survives its owner's account deletion as
                    -- an orphan rather than disappearing. See
                    -- 20260801000000_account_deletion_cascades.sql.
  name            text not null,
  address_label   text,        -- free-text display only, never geocoded
  qr_token        text unique not null,  -- Phase 6: the printed venue code --
                                           -- no expiry by design, minted once
                                           -- at creation, invalidated only by
                                           -- a deliberate regenerate call
  qr_token_issued_at timestamptz not null default now(),
  created_at      timestamptz not null default now(),

  -- Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §3): the ceiling on what a
  -- static_qr session at this venue may block. That session type seats up
  -- to VENUE_SESSION_MAX_PARTICIPANTS strangers who scanned a printed code,
  -- and nothing else stops a cafe blocking a competitor's app -- so the
  -- business's choice is approved OUT OF BAND, the same manual-flag posture
  -- Verified Host itself uses (ARCHITECTURE.md §10). No in-app application
  -- flow; the owner edits these columns in Supabase.
  --
  -- The default is the same three categories, so a new business is useful
  -- immediately and only needs attention if it wants to name specific apps.
  -- The server rejects any static_qr session whose blocklist falls outside
  -- these arrays (sessions.router.ts, `blocklist_not_venue_approved`).
  approved_blocked_categories text[] not null default '{social,games,entertainment}',
  approved_blocked_packages   text[] not null default '{}',

  constraint chk_venue_approved_categories_valid
    check (approved_blocked_categories <@ array['social', 'games', 'entertainment', 'news', 'maps', 'productivity']::text[])
);

-- ============================================================
-- SESSIONS
-- ============================================================
create table public.sessions (
  id                       uuid primary key default gen_random_uuid(),
  host_id                  uuid not null references public.users(id) on delete cascade,
                             -- Phase 7: the session (and everything that
                             -- itself cascades from session_id below) is
                             -- deleted when its host deletes their account
                             -- -- "your data disappears with you", applied
                             -- to the object the host created. See the
                             -- design-choice comment atop
                             -- 20260801000000_account_deletion_cascades.sql
                             -- for the full reasoning and its one deliberate
                             -- carve-out (rewards_history, below).
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
  ended_by                 uuid references public.users(id) on delete set null,
  end_reason               text
                             check (end_reason in ('host_ended', 'planned_duration_reached', 'force_terminated')),
  created_at               timestamptz not null default now(),

  -- Phase 9 (docs/BLOCKLIST_SELECTION_PLAN.md §3): what THIS session
  -- blocks, chosen by the host at creation. Two plain-string arrays, and
  -- the "plain string" part is the whole design: a category name or a
  -- package name means something on every member's device, where an opaque
  -- per-device handle would not. Each device resolves the name against its
  -- own installed apps at block time, so a member without Instagram simply
  -- loses nothing.
  --
  -- Arrays rather than JSONB or a join table: always read as a unit, never
  -- queried independently, bounded at ~56 short strings — and arrays keep
  -- CHECK constraints and array operators, which JSONB would cost.
  --
  -- The default is the three categories every pre-existing session
  -- enforced, so any code path not yet updated keeps working unchanged.
  blocked_categories       text[] not null default '{social,games,entertainment}',
  blocked_packages         text[] not null default '{}',

  constraint chk_dynamic_qr_has_token
    check (type = 'solo' or qr_token is not null),
  constraint chk_fixed_has_duration
    check (duration_mode = 'open_ended' or planned_duration_minutes is not null),
  constraint chk_blocked_categories_valid
    check (blocked_categories <@ array['social', 'games', 'entertainment', 'news', 'maps', 'productivity']::text[]),
  -- An accident-guard, not an anti-abuse control: a host set on gaming it
  -- can pick one obscure app they don't have. It exists so nobody
  -- *accidentally* creates a session that blocks nothing while paying
  -- 1pt/min. Real anti-abuse would need server-verifiable enforcement,
  -- which neither platform offers.
  constraint chk_blocklist_non_empty
    check (cardinality(blocked_categories) + cardinality(blocked_packages) > 0)
);

create index idx_sessions_status on public.sessions(status) where status in ('pending', 'active');
create index idx_sessions_host on public.sessions(host_id);

-- ============================================================
-- HOST ASSIGNMENT AUDIT (initial host + every migration)
-- ============================================================
create table public.session_host_assignments (
  id            uuid primary key default gen_random_uuid(),
  session_id    uuid not null references public.sessions(id) on delete cascade,
  user_id       uuid not null references public.users(id) on delete cascade,
                  -- Phase 7: was missing an ON DELETE action -- a
                  -- migrated-away past host deleting their account while
                  -- the session still exists must not be blocked.
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
  user_id           uuid not null references public.users(id) on delete cascade,
                      -- Phase 7: a participant deleting their own account
                      -- removes their own presence rows without needing
                      -- the whole session (or its host) gone.
  joined_at         timestamptz not null default now(),
  left_at           timestamptz,      -- null while still connected
  disconnect_reason text
                      check (disconnect_reason in ('emergency_exit', 'involuntary_disconnect', 'session_ended')),
  blocker_ready_at  timestamptz,      -- Phase 4: set once the device confirms
                                       -- the native blocker actually started;
                                       -- null = never counts toward the Group
                                       -- Bonus 5+ threshold (still counts for
                                       -- base points). See §7 "Bonus Computation".
  device_trust_tier text not null default 'trusted'
                      check (device_trust_tier in ('trusted', 'unverified'))
                                       -- Phase 6: already enforcement-gated at
                                       -- write time (markDeviceTrust ->
                                       -- attestation/trust-tier.ts) -- with
                                       -- ATTESTATION_ENFORCEMENT_ENABLED=false
                                       -- (the shipping default) this is always
                                       -- 'trusted'. 'unverified' excludes the
                                       -- interval from the Group Bonus only,
                                       -- same shape as blocker_ready_at above.
);

create index idx_presence_session on public.session_presence_intervals(session_id);
create index idx_presence_user on public.session_presence_intervals(user_id);

-- ============================================================
-- SESSION PARTICIPANTS (per-user summary row, computed at session close)
-- ============================================================
create table public.session_participants (
  id                        uuid primary key default gen_random_uuid(),
  session_id                uuid not null references public.sessions(id) on delete cascade,
  user_id                   uuid not null references public.users(id) on delete cascade,
                              -- Phase 7: same reasoning as
                              -- session_presence_intervals.user_id above.
  is_host                   boolean not null default false,
  total_minutes_present     int not null default 0,
  exit_reason               text check (exit_reason in ('completed', 'emergency_exit', 'disconnected')),
  group_bonus_earned        boolean not null default false,
  completion_bonus_earned   boolean not null default false,
  points_earned             int not null default 0,
  stats_applied_at          timestamptz,  -- Phase 5: set by
                                           -- apply_session_stats() -- the
                                           -- exactly-once guard against
                                           -- double-accumulating into
                                           -- user_stats/user_streaks
  device_trust_tier         text not null default 'trusted'
                              check (device_trust_tier in ('trusted', 'unverified')),
                                           -- Phase 6: 'unverified' if ANY of
                                           -- this participant's intervals this
                                           -- session was unverified -- feeds
                                           -- apply_session_stats()'s streak-
                                           -- exclusion gate (bonus/streak only,
                                           -- never base points/lifetime stats)

  unique (session_id, user_id)
);

create index idx_participants_session on public.session_participants(session_id);
create index idx_participants_user on public.session_participants(user_id);

-- ============================================================
-- DEVICE ATTESTATIONS (Play Integrity / App Attest — monitor-mode only,
-- ARCHITECTURE.md §8 item 8; Node-internal, no client read path at all —
-- no RLS policy and no grant, unlike every other table above)
-- ============================================================
create table public.device_attestations (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
                 -- Phase 7: was missing an ON DELETE action -- this is
                 -- exactly the raw-provider-payload data named in the
                 -- account-deletion data footprint, so it must actually be
                 -- deletable, not just block the delete.
  session_id   uuid references public.sessions(id) on delete cascade,
  platform     text not null check (platform in ('android', 'ios')),
  action       text not null check (action in ('create', 'join')),
  verdict      text not null,
  raw_response jsonb not null,   -- full provider payload, for Phase 6 re-analysis
  created_at   timestamptz not null default now()
);

-- ============================================================
-- RLS HELPER: is_session_participant(session_id) — true if the current
-- auth.uid() is the session's host or has ever joined it (a presence
-- interval exists). SECURITY DEFINER + search_path='' (same pattern as
-- handle_new_user()) so the read policies on sessions/session_*  tables
-- above can all call this without recursing into each other's policies.
-- ============================================================
create function public.is_session_participant(p_session_id uuid)
  returns boolean language sql security definer set search_path = '' stable
  as $$ ... $$;

-- ============================================================
-- JOIN_SESSION(): the one atomic entry point for joining a session —
-- `select ... for update` row-locks the session so two devices racing the
-- last open slot serialize here instead of both reading "49 present" from
-- a separate SELECT and both inserting (a classic TOCTOU race). Also
-- re-validates the token against the session's CURRENT qr_token column
-- (not just its signature — a regenerated QR's old token still signs
-- correctly but no longer matches). Returns one of: 'joined',
-- 'already_joined' (idempotent rejoin), 'not_found', 'not_joinable',
-- 'invalid_token', 'expired', 'at_capacity'. Node-only — EXECUTE is
-- granted to service_role, revoked from public.
-- ============================================================
create function public.join_session(
  p_session_id uuid, p_user_id uuid, p_token text, p_max_participants int
) returns text language plpgsql security definer set search_path = ''
  as $$ ... $$;

create index idx_presence_open on public.session_presence_intervals(session_id)
  where left_at is null;

-- ============================================================
-- REJOIN_SESSION(): Phase 4 task 12's token-free counterpart to
-- JOIN_SESSION() above, for Screen 13 (Welcome Back). Same row-locking
-- shape, but authorizes on prior participation (any existing
-- session_presence_intervals row for that user+session) instead of a QR
-- token — the 15-minute QR_TOKEN_TTL_MINUTES is far shorter than the
-- offline/relaunch gaps this exists for, so a still-valid token can't be
-- assumed. Returns one of: 'joined', 'already_joined' (idempotent
-- rejoin), 'not_found', 'not_joinable', 'not_a_participant', 'at_capacity'.
-- Node-only — EXECUTE granted to service_role, revoked from public.
-- ============================================================
create function public.rejoin_session(
  p_session_id uuid, p_user_id uuid, p_max_participants int
) returns text language plpgsql security definer set search_path = ''
  as $$ ... $$;

-- ============================================================
-- JOIN_VENUE_SESSION(): Phase 6 task 2's venue-scoped counterpart to
-- JOIN_SESSION() -- resolves "the venue's currently active static_qr
-- session" and joins it in one atomic statement (same row-locking
-- reasoning as JOIN_SESSION() -- two devices scanning the same venue QR
-- at the same instant, right as one session ends and another starts,
-- must not both succeed against a session that's no longer current).
-- p_token is checked against the venue's CURRENT qr_token column, exactly
-- like JOIN_SESSION() checks its token against sessions.qr_token -- this
-- is what makes regenerating a venue's code actually invalidate the old
-- printout. Returns a (outcome, session_id) row, not plain text, since
-- resolving the session id IS this function's job -- Node doesn't know it
-- ahead of time the way it does for a session token. Outcomes: 'joined',
-- 'already_joined', 'invalid_token', 'venue_not_found',
-- 'no_active_session', 'at_capacity'. Node-only.
-- ============================================================
create function public.join_venue_session(
  p_venue_id uuid, p_token text, p_user_id uuid, p_max_participants int
) returns table(outcome text, session_id uuid)
  language plpgsql security definer set search_path = ''
  as $$ ... $$;

-- ============================================================
-- GET_VENUE_METRICS(): Phase 6 task 5's B2B dashboard data source. A
-- plain STABLE SQL function (not row-locking PL/pgSQL like the join
-- functions above) -- this reads a snapshot for display, never decides or
-- writes anything, so there's no correctness reason to serialize
-- concurrent callers. One function rather than several Node round trips
-- averaged in-process: PostgREST's query builder has no native
-- avg()/count() aggregate support the way a plain SQL function does.
-- Returns concurrent_active_customers (live open-interval count on the
-- venue's active sessions), sessions_in_window and
-- avg_minutes_per_customer (both over the trailing p_window_start).
-- Node-only.
-- ============================================================
create function public.get_venue_metrics(
  p_venue_id uuid, p_window_start timestamptz
) returns table(
    concurrent_active_customers int,
    sessions_in_window int,
    avg_minutes_per_customer numeric
  )
  language sql security definer set search_path = '' stable
  as $$ ... $$;

-- ============================================================
-- USER STREAKS
-- ============================================================
create table public.user_streaks (
  user_id                 uuid primary key references public.users(id) on delete cascade,
  current_streak          int not null default 0,
  longest_streak          int not null default 0,
  last_session_at         timestamptz,
  last_session_day        date,         -- Phase 5 deviation: the resolved
                                          -- LOCAL day of last_session_at
                                          -- (users.timezone), stored rather
                                          -- than re-derived on every
                                          -- comparison -- same-day repeat
                                          -- sessions must not double-
                                          -- increment current_streak
  streak_grace_expires_at timestamptz,  -- last_session_at + STREAK_GRACE_HOURS
  risk_notification_sent_for timestamptz  -- Phase 5.5: WHICH
                                -- streak_grace_expires_at value the
                                -- streak-risk push was last sent for (not
                                -- a boolean) -- a fresh deadline (pushed
                                -- forward by a new session) is always
                                -- eligible again, while the same
                                -- still-pending deadline is never
                                -- re-claimed across repeated poll ticks
                                -- (see claim_streak_risk_notifications()
                                -- below)
);

-- ============================================================
-- CLAIM_STREAK_RISK_NOTIFICATIONS(): Phase 5.5's streak-risk dispatch job
-- atomically claims every streak within p_window_hours of expiry that
-- hasn't already been notified for that exact deadline, in one
-- UPDATE ... RETURNING -- the same race a naive "select candidates, then
-- send, then mark sent" would have (a poll tick overlapping the previous
-- one's send could re-notify before the "already notified" write lands)
-- is closed the same way join_session()/apply_session_stats() close
-- theirs. No separate "did they already have a session today" check is
-- needed -- streak_grace_expires_at already IS that signal (a session
-- pushes it past the window automatically); an already-broken streak
-- (current_streak = 0, set by the streak-expiry job) is naturally
-- excluded too. Node-only.
-- ============================================================
create function public.claim_streak_risk_notifications(
  p_now timestamptz, p_window_hours int
) returns table(user_id uuid)
  language plpgsql security definer set search_path = ''
  as $$ ... $$;

-- ============================================================
-- DEVICE_TOKENS (Phase 5.5, docs/RETENTION_STRATEGY.md §5) -- one row per
-- (user_id, platform): registering a fresh token upserts on this
-- constraint, so a reinstall replaces the old token instead of
-- accumulating a duplicate (owner decision -- a second same-platform
-- device steals the notification slot, an accepted MVP limitation).
-- Registered directly by the client under RLS (not money-equivalent, same
-- posture as timezone/locale) -- service_role only gets SELECT, to read
-- send targets for the streak-risk dispatch job; there is no service_role
-- write grant, this table is never written from Node.
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

-- ============================================================
-- FRIEND_REQUESTS (Phase 6.5) -- ephemeral: accepted becomes a
-- friendships row, declined/cancelled is just deleted, never a persisted
-- terminal status.
-- ============================================================
create table public.friend_requests (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.users(id) on delete cascade,
  recipient_id uuid not null references public.users(id) on delete cascade,
  created_at   timestamptz not null default now(),
  check (requester_id <> recipient_id),
  unique (requester_id, recipient_id)
);

-- ============================================================
-- FRIENDSHIPS (Phase 6.5) -- canonical (user_id_a < user_id_b) ordering
-- guarantees exactly one row per pair regardless of who sent the
-- original request, the same push-the-invariant-into-the-schema
-- principle as Phase 6's partial unique index on one active static_qr
-- session per venue. Only ever created by send_friend_request()/
-- respond_to_friend_request() below -- no insert/update grant for
-- authenticated. Unfriending is a direct client-side RLS delete (either
-- party), no Node round trip.
-- ============================================================
create table public.friendships (
  user_id_a  uuid not null references public.users(id) on delete cascade,
  user_id_b  uuid not null references public.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  check (user_id_a < user_id_b),
  primary key (user_id_a, user_id_b)
);

-- ============================================================
-- SEND_FRIEND_REQUEST() / RESPOND_TO_FRIEND_REQUEST(): Node-only atomic
-- functions (Phase 6.5). A mutual double-request (both users request each
-- other before either responds) auto-resolves to a friendship
-- immediately -- both functions delete any pending request in EITHER
-- direction before inserting a friendship and wrap the insert against
-- unique_violation, closing a real concurrent-opposite-direction race
-- (two truly simultaneous calls could each discover "no reverse request
-- yet" before either commits).
-- ============================================================
create function public.send_friend_request(
  p_requester_id uuid, p_recipient_id uuid
) returns text
  language plpgsql security definer set search_path = ''
  as $$ ... $$;

create function public.respond_to_friend_request(
  p_recipient_id uuid, p_request_id uuid, p_accept boolean
) returns text
  language plpgsql security definer set search_path = ''
  as $$ ... $$;

-- ============================================================
-- USER STATS (lifetime aggregates — Home screen summary)
-- ============================================================
create table public.user_stats (
  user_id                 uuid primary key references public.users(id) on delete cascade,
  total_minutes           int not null default 0,
  total_points            int not null default 0,
  sessions_completed      int not null default 0,
  sessions_emergency_exit int not null default 0,
  sessions_disconnected   int not null default 0,  -- Phase 5 deviation: the
                                                      -- original blueprint
                                                      -- only had two exit-
                                                      -- reason counters, but
                                                      -- Phase 4 added a third
                                                      -- exit_reason
                                                      -- ('disconnected') that
                                                      -- counted toward
                                                      -- neither
  updated_at              timestamptz not null default now()
);

-- ============================================================
-- USER STATS DAILY (time series — Stats screen 7-day chart)
-- ============================================================
create table public.user_stats_daily (
  user_id  uuid not null references public.users(id) on delete cascade,
  day      date not null,
  minutes  int not null default 0,
  points   int not null default 0,
  sessions int not null default 0,
  primary key (user_id, day)
);

-- ============================================================
-- REWARDS HISTORY (audit trail for every point-granting event)
-- ============================================================
create table public.rewards_history (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
               -- Phase 7: cascades -- this is the row owner's own receipt.
  session_id uuid references public.sessions(id) on delete set null,
               -- Phase 7: SET NULL, deliberately NOT cascade, unlike every
               -- other session_id FK above -- this is the one exception to
               -- "cascades with the session". If it cascaded, another
               -- participant's own earned-points receipt would be destroyed
               -- just because the session's HOST deleted their account and
               -- took the session with them. SET NULL keeps the receipt,
               -- drops only the now-dangling session reference.
  points     int not null,
  bonus_type text not null
               check (bonus_type in ('base', 'group_bonus', 'completion_bonus', 'milestone')),
  created_at timestamptz not null default now()
);

create index idx_rewards_user_time on public.rewards_history(user_id, created_at desc);

-- ============================================================
-- MILESTONES (global, periodic — not per-session). Seeded, fixed product
-- config -- 6 tiers, decided during Phase 5 planning
-- (docs/RETENTION_STRATEGY.md §2): 5/10/25/50/100/250 sessions,
-- 50/100/250/500/1000/2500 bonus points.
-- ============================================================
create table public.milestones (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,  -- Phase 5 deviation: `name`
                                             -- below is a DB string, which
                                             -- would be an untranslatable
                                             -- hardcoded UI string --
                                             -- `slug` is the i18n key
                                             -- instead (t('milestones.' +
                                             -- slug))
  name              text not null,
  sessions_required int not null,
  bonus_points      int not null
);

create table public.user_milestones (
  user_id      uuid not null references public.users(id) on delete cascade,
  milestone_id uuid not null references public.milestones(id),
  achieved_at  timestamptz not null default now(),
  primary key (user_id, milestone_id)
);
```

## Bonus Computation (business logic, not stored procedures)

Computed by the Node API at session-close time, from `session_presence_intervals`, and written once into `session_participants` + `rewards_history`. Never computed client-side, never re-computed on read.

1. Build a timeline of concurrent-participant-count from all intervals in the session.
2. Find maximal continuous sub-intervals where count ≥ 5. Discard any shorter than 30 minutes — these confer no bonus at all (no partial credit).
3. For each surviving ≥30-minute streak, any participant whose own presence was unbroken for that streak's full duration and whose final `exit_reason = 'completed'` gets `group_bonus_earned = true`.
4. For Completion Bonus: check the session's actual duration ≥ 60 minutes, the participant's first interval started within ~60s of `sessions.started_at`, they have exactly one interval spanning the whole session (no disconnect gaps), and `exit_reason = 'completed'`.
5. `points_earned = round(base_points × (100 + bonus_percent) / 100)`, where `base_points = total_minutes_present × BASE_POINTS_PER_MINUTE` and `bonus_percent` is the sum of whichever bonus percentages were earned (0/10/20) — additive on the percentage, never compounded (e.g. both earned means ×1.20 once, not ×1.10 twice). Rounded once at the end, not per-bonus, to avoid compounding rounding drift.
6. Step 1's "concurrent-participant-count" timeline only counts a participant from the moment their device confirms local blocker setup (`session_presence_intervals.blocker_ready_at`, Phase 4), never from raw `joined_at` — closes the Sybil/bonus-farming vector (§7, §8 item 9). Base points (step 5) are unaffected by this gate and still use the participant's real `joined_at`/`left_at`.
7. **Phase 6**: an interval whose `device_trust_tier = 'unverified'` (already enforcement-gated at write time, §8 item 8) is excluded from step 1's timeline exactly like an unconfirmed `blocker_ready_at` — it contributes no event and can never push another participant over the 5-participant threshold either — and is excluded from its own Group Bonus eligibility in step 3. Base points and the Completion Bonus are unaffected by this gate.

An `exit_reason` of `emergency_exit` or `disconnected` (Phase 4 — a participant who went offline and never reconnected before the session ended) forfeits both bonuses unconditionally, regardless of how close they were to qualifying; base points for actual minutes present are always kept.

Implemented as pure functions in `apps/server/src/modules/points/` (`base-points.ts`, `group-bonus.ts` — a sweep-line/interval-merge reconstruction of the concurrent-count timeline, `completion-bonus.ts`, `compute-rewards.ts`), 90%+ branch-covered per `.claude/skills/testing-standards/SKILL.md`'s money-equivalent-module bar. `computeSessionRewards()` is the whole-session entry point (called at session end); `computeForfeitedReward()` is the single-participant, bonus-free shortcut used for inline emergency-exit finalization, since that never needs the rest of the session's data. `ParticipantReward` carries a `basePoints`/`groupBonusPoints`/`completionBonusPoints` breakdown (split from the single authoritative `pointsEarned`, not re-derived) so `rewards_history` gets one row per bonus category actually earned.

**Session-end wiring (Phase 4):** `POST /sessions/:id/end` (host-only) and the future auto-close sweep both call `apps/server/src/modules/sessions/end-session.ts`'s `endSession()` — the one place that closes every open `session_presence_intervals` row, runs `computeSessionRewards()`, and writes `session_participants` + `rewards_history` once. A participant already finalized inline (emergency exit) still has their presence intervals fed into the computation (their headcount still matters for everyone else's group bonus), just not re-written.

All rules above are confirmed final — see `docs/ARCHITECTURE.md` §7/§11.

## Stats/Streak/Milestone Accumulation (Phase 5)

Unlike the bonus computation above (pure functions, computed by Node and written once), streak/milestone/lifetime-aggregate accumulation is a **Postgres function**, `public.apply_session_stats(p_session_id, p_user_id, p_finalized_at, p_streak_grace_hours, p_device_trust_tier default 'trusted')` (`supabase/migrations/20260728160000_create_apply_session_stats_function.sql`, 5th parameter added by Phase 6's `20260729000500_device_trust_tier.sql`). **A real Postgres gotcha from that later migration, caught by the actual `supabase test db` run**: `CREATE OR REPLACE FUNCTION` only replaces a function with the *exact same* parameter list — adding a parameter, even a defaulted one, creates a new overload instead, leaving the original 4-arg function ambiguously resolvable alongside the new 5-arg one for any plain 4-argument call. Fixed with an explicit `DROP FUNCTION IF EXISTS` on the old signature before recreating it with five. Why the split: `computeSessionRewards()` only ever needs data from the one session it's closing, so a pure Node function is the right shape. Accumulation needs to read-modify-write a *cross-session* row (`user_stats`, `user_streaks`) from **two independent Node call sites** (`end-session.ts` and `finalize-emergency-exit.ts`), either of which can race the sweep worker or each other for the same user across different sessions — a Node-side read-then-write has a lost-update window no application-level care closes. A single `SECURITY DEFINER` function does the whole read-decide-write cycle under row locks inside one transaction, the same precedent as `join_session()`/`rejoin_session()`.

Called once per finalized `session_participants` row, after that row (and its `rewards_history` base/bonus rows) already exist. Returns `'applied'` or `'skipped'` (exactly-once guard via `session_participants.stats_applied_at`, or the row not existing at all).

1. Lock the `session_participants` row; skip if missing or already applied.
2. Resolve the participant's **local day**: `(p_finalized_at at time zone coalesce(users.timezone, 'UTC'))::date` — an unrecognized/garbage timezone string falls back to UTC rather than aborting finalization.
3. Accumulate into `user_stats`: `total_minutes`, `total_points`, and whichever of `sessions_completed`/`sessions_emergency_exit`/`sessions_disconnected` matches `exit_reason`.
4. Upsert `user_stats_daily` for that local day.
5. **Streak** (`user_streaks`, any session with presence counts — `docs/RETENTION_STRATEGY.md` §1's forgiving-by-design decision): first-ever session starts it at 1; a later finalization timestamped *before* `last_session_at` (out-of-order — e.g. the sweep worker closing a stale interval after the participant already started a fresh session elsewhere) leaves the streak untouched entirely, stats still applied; the same local day as `last_session_day` doesn't double-count but still pushes `streak_grace_expires_at` forward; a gap within `STREAK_GRACE_HOURS` on a new day increments; a gap beyond it resets to 1. `longest_streak` is a monotonic high-water mark, never decremented here (only session-close code path — see the separate streak-expiry job below for how `current_streak` gets zeroed by the passage of time alone). **Phase 6**: when `p_device_trust_tier = 'unverified'`, this whole branch is skipped entirely (the streak is left exactly as it was) — steps 1-4 above (lifetime stats, daily time series) still run unconditionally; only bonus-earning (handled in Node, see above) and streak advancement are ever gated by device trust.
6. **Milestones**: `insert into user_milestones ... select ... where sessions_required <= (just-updated total) on conflict do nothing returning milestone_id`, looped — set-based and naturally idempotent, correctly handles crossing more than one tier in a single session. Each crossing writes one `rewards_history` row (`bonus_type='milestone'`) and folds `bonus_points` into `user_stats.total_points` in the same transaction — this is what keeps `total_points == sum(rewards_history.points)` true by construction rather than by convention.
7. Sets `stats_applied_at = p_finalized_at`.

**Streak expiry** is a separate concern from the above: nothing at session-close time can *break* a streak, since a break is caused by the passage of time, not an event. `apps/server/src/modules/stats/streak-expiry.ts`'s `runStreakExpiry()` — the same testable-core-plus-`setInterval` split as the Phase 4 sweep worker, on its own `STREAK_EXPIRY_INTERVAL_SECONDS` cadence (300s — no debounce-window concern the way host migration has, so it can run far less often) — delegates to `SessionsStore.expireStreaks(asOf)`, a single scoped `UPDATE ... SET current_streak = 0 WHERE streak_grace_expires_at < asOf AND current_streak > 0`. Deliberately a plain `service_role`-granted UPDATE, not a `SECURITY DEFINER` function: zeroing an already-expired streak has no atomicity concern the way `apply_session_stats()`'s cross-table read-decide-write does. `longest_streak` is never touched by this job — it's a monotonic high-water mark.

**Streak-risk notification (Phase 5.5)** is a third, independent concern from both of the above: neither accumulation nor expiry needs to know a notification was ever sent. `public.claim_streak_risk_notifications(p_now, p_window_hours)` (`supabase/migrations/20260730000100_streak_risk_notification_claim.sql`) atomically claims every streak within `p_window_hours` of `streak_grace_expires_at` that hasn't already been notified for that exact deadline, via a single `UPDATE ... RETURNING` — the same race a naive "select candidates, then send, then mark sent" would have (an overlapping poll tick re-notifying before the "already notified" write lands) is closed the same way `join_session()`/`apply_session_stats()` close theirs. `apps/server/src/modules/notifications/streak-risk-notifier.ts`'s `runStreakRiskNotifications()` — same testable-core-plus-`setInterval` split, `STREAK_RISK_NOTIFICATION_INTERVAL_SECONDS` cadence — calls it, looks up registered `device_tokens` + `users.locale` for whoever was claimed, and dispatches through the `NotificationSender` seam (`unconfiguredNotificationSender` today — no FCM/APNs credentials exist yet, same posture as attestation). A claimed user with no registered device token still consumes their notification window (no send attempted, no error) — the claim represents "this deadline was processed," decoupled from whether a device existed to deliver to.

**Friends leaderboard (Phase 6.5)** reads `user_stats.total_points`/`user_streaks.last_session_day` but writes nothing — a pure aggregate read, computed by Node (`FriendsStore.listFriends()`), never a widened RLS policy. `apps/server/src/modules/friends/local-date.ts`'s `hadSessionToday()` reduces `last_session_day` down to a boolean by comparing it against that friend's own local day (`Intl.DateTimeFormat('en-CA', {timeZone})`, UTC-fallback on a garbage/missing zone — the same posture as `apply_session_stats()`'s own local-day resolution, without needing a timezone library). Only `total_points` and this boolean are ever returned for a friend; `current_streak` and everything else those two tables hold never crosses the Node/client boundary.

## Config Constants (Node, not DB — tune here, not in migrations)

| Constant | Default | Notes |
|---|---|---|
| `BASE_POINTS_PER_MINUTE` | 1 | confirmed |
| `QR_TOKEN_TTL_MINUTES` | 15 | dynamic_qr/static_qr session's signed token lifetime; host can regenerate on demand (`apps/server/src/config/constants.ts`) |
| `SESSION_MAX_PARTICIPANTS` | 50 | server-enforced cap on concurrent (open-interval) participants; not yet a per-session/host-chosen value — no product decision exists for that, see `apps/server/src/config/constants.ts` |
| `GROUP_BONUS_PERCENT` | 10 | fixed, not a formula |
| `GROUP_BONUS_MIN_PARTICIPANTS` | 5 | |
| `GROUP_BONUS_MIN_MINUTES` | 30 | continuous, resets on any drop below threshold |
| `COMPLETION_BONUS_PERCENT` | 10 | |
| `COMPLETION_BONUS_MIN_SESSION_MINUTES` | 60 | |
| `COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS` | 60 | practical tolerance for "joined at the start" |
| `HOST_MIGRATION_PRESENCE_TIMEOUT_SECONDS` | 20 | debounced to avoid migration storms |
| `PARTICIPANT_PRESENCE_TIMEOUT_MINUTES` | 30 | non-host stale-interval reconciliation (Phase 4) — matches the native offline-cutoff grace period, §4, so a brief disconnect isn't penalized |
| `OPEN_ENDED_SESSION_MAX_HOURS` | 24 | server force-closes past this |
| `STREAK_GRACE_HOURS` | 48 | |
| `STREAK_EXPIRY_INTERVAL_SECONDS` | 300 | streak-expiry job cadence (Phase 5) — no debounce concern, so it runs far less often than the session sweep |
| `DEFAULT_BLOCKED_CATEGORIES` | `[social, games, entertainment]` | Phase 9 — what the Create Session picker pre-fills, what `POST /sessions` falls back to when a client sends no blocklist, and the `sessions.blocked_categories` column default. **No longer the enforced truth**: the host chooses per session from six categories plus specific apps (`sessions.blocked_categories` / `blocked_packages` above, `docs/BLOCKLIST_SELECTION_PLAN.md`). This value is the *historical* three, kept as the default so existing habits and any not-yet-updated code path are unchanged. Lives in `apps/server/src/modules/sessions/blocklist.ts` |
| `MAX_BLOCKED_PACKAGES` | 50 | Phase 9 — caps the specific-app list on `POST /sessions`, bounding the payload. No matching category cap: six *is* the maximum, since selecting all of them is legitimate |
| `VENUE_SESSION_MAX_PARTICIPANTS` | 200 | Phase 6 — a verified host's `static_qr` venue session, higher than `SESSION_MAX_PARTICIPANTS` since a business's foot traffic is a different shape of "group" than a friend session; a config constant, not a per-venue DB column, for MVP simplicity |
| `VENUE_METRICS_WINDOW_DAYS` | 30 | Phase 6 — the trailing window `GET /venues/:id/metrics`'s "average session duration/customer" is computed over |
| `ATTESTATION_ENFORCEMENT_ENABLED` | `false` | Phase 6 — built-but-inert: no real Play Integrity/App Attest credentials or monitor-mode data exist yet to threshold against (every recorded verdict today reads `not_configured`). Gates `attestation/trust-tier.ts`'s `applyEnforcementPolicy()`, the one place that matters — every downstream reader (`points/group-bonus.ts`, `apply_session_stats()`) just trusts whatever tier was already written. Flipping to `true` is the only remaining step once real credentials exist. |
| `STREAK_RISK_NOTIFICATION_WINDOW_HOURS` | 6 | Phase 5.5 — owner decision: the streak-risk push fires once `streak_grace_expires_at` is within this many hours (~12.5% of `STREAK_GRACE_HOURS`) |
| `STREAK_RISK_NOTIFICATION_INTERVAL_SECONDS` | 300 | Phase 5.5 — dispatch job cadence; no debounce concern (the claim function itself prevents a double-send), same reasoning as `STREAK_EXPIRY_INTERVAL_SECONDS` |
| `MIN_FRIEND_SEARCH_QUERY_LENGTH` | 2 | Phase 6.5 — `GET /friends/search`'s floor; a proportionate mitigation against trivially enumerating the whole username space one character at a time, not full abuse-prevention infra |
