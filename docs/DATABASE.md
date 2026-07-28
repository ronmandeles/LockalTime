# Lockal Time — Database Schema

Status: planning blueprint, except the tables implemented so far. `users` — implemented (`supabase/migrations/20260718015352_create_users.sql`), migrated to both local and production (`LockalTime`), pgTAP-verified (`supabase/tests/users_test.sql`). The signup trigger (`supabase/migrations/20260718192504_create_users_signup_trigger.sql`) is implemented and pgTAP-verified locally (`supabase/tests/users_trigger_test.sql`); production push pending (done manually by the user per `CLAUDE.md`). **Phase 2 task 2.1** (`supabase/migrations/20260726225500_create_venues.sql`, `20260726225600_create_sessions_core.sql`): `venues`, `sessions`, `session_host_assignments`, `session_presence_intervals`, `session_participants`, `device_attestations` implemented and pgTAP-verified locally. **Phase 2 task 2.3** (`supabase/migrations/20260726225700_create_join_session_function.sql`): `join_session()` atomic-join RPC. **Phase 4 task 2** (`supabase/migrations/20260728120000_phase4_lifecycle_and_rewards.sql`): `rewards_history` created (RLS: own rows only); `sessions.end_reason` gains `force_terminated`; `session_participants.exit_reason` gains `disconnected`; `session_presence_intervals` gains `blocker_ready_at`. **Phase 4 task 7** (`supabase/migrations/20260728130000_grant_host_assignments_update.sql`): `session_host_assignments` gains a `service_role` `UPDATE` grant — the original Phase 2 migration only granted `select, insert`, missed until the sweep worker's real integration test tried to close a migrated-away host's assignment row and hit `permission denied`. **Phase 4 task 12** (`supabase/migrations/20260728140000_create_rejoin_session_function.sql`): `rejoin_session()`, the token-free counterpart to `join_session()` for Screen 13's Welcome Back rejoin. **Phase 5 task 2** (`supabase/migrations/20260728150000_phase5_gamification_and_stats.sql`): `user_streaks`, `user_stats`, `user_stats_daily`, `milestones` (seeded, 6 tiers), `user_milestones` created; `users.timezone` and `session_participants.stats_applied_at` added. Three deliberate deviations from this file's original blueprint below it (see the "Bonus Computation"/"Gamification" sections for why): `user_stats.sessions_disconnected`, `user_streaks.last_session_day`, `milestones.slug`. 108/108 pgTAP passing (adds `supabase/tests/phase5_gamification_test.sql`, 28 new), plus a real integration suite (`apps/server/integration/sessions.integration.test.ts`) covering create→join→leave, RLS, true concurrent-join-at-capacity, and create→join→disconnect→rejoin→end (proving the disconnect gap disqualifies the Completion Bonus while base points are still credited — the Phase 4 DoD's disconnect-and-rejoin line) against the live local stack; production push pending (manual, per `CLAUDE.md`). This is the consolidated, final-for-now schema reflecting every decision made during architecture planning. Update this file whenever a migration changes the shape of the data — `supabase/migrations/` is the executable source of truth, this file is the human-readable explanation of *why* it looks the way it does.

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
  avatar_url      text,
  role            text not null default 'user'
                    check (role in ('user', 'verified_host', 'admin')),
  timezone        text,        -- Phase 5: IANA zone name, client-reported,
                                -- used to bucket sessions into the
                                -- participant's LOCAL day (see
                                -- apply_session_stats() below)
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
  owner_id        uuid not null references public.users(id),
  name            text not null,
  address_label   text,        -- free-text display only, never geocoded
  created_at      timestamptz not null default now()
);

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
                             check (end_reason in ('host_ended', 'planned_duration_reached', 'force_terminated')),
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
                      check (disconnect_reason in ('emergency_exit', 'involuntary_disconnect', 'session_ended')),
  blocker_ready_at  timestamptz       -- Phase 4: set once the device confirms
                                       -- the native blocker actually started;
                                       -- null = never counts toward the Group
                                       -- Bonus 5+ threshold (still counts for
                                       -- base points). See §7 "Bonus Computation".
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
  exit_reason               text check (exit_reason in ('completed', 'emergency_exit', 'disconnected')),
  group_bonus_earned        boolean not null default false,
  completion_bonus_earned   boolean not null default false,
  points_earned             int not null default 0,
  stats_applied_at          timestamptz,  -- Phase 5: set by
                                           -- apply_session_stats() -- the
                                           -- exactly-once guard against
                                           -- double-accumulating into
                                           -- user_stats/user_streaks

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
  user_id      uuid not null references public.users(id),
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
  streak_grace_expires_at timestamptz   -- last_session_at + STREAK_GRACE_HOURS
);

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
  user_id    uuid not null references public.users(id),
  session_id uuid references public.sessions(id),
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

An `exit_reason` of `emergency_exit` or `disconnected` (Phase 4 — a participant who went offline and never reconnected before the session ended) forfeits both bonuses unconditionally, regardless of how close they were to qualifying; base points for actual minutes present are always kept.

Implemented as pure functions in `apps/server/src/modules/points/` (`base-points.ts`, `group-bonus.ts` — a sweep-line/interval-merge reconstruction of the concurrent-count timeline, `completion-bonus.ts`, `compute-rewards.ts`), 90%+ branch-covered per `.claude/skills/testing-standards/SKILL.md`'s money-equivalent-module bar. `computeSessionRewards()` is the whole-session entry point (called at session end); `computeForfeitedReward()` is the single-participant, bonus-free shortcut used for inline emergency-exit finalization, since that never needs the rest of the session's data. `ParticipantReward` carries a `basePoints`/`groupBonusPoints`/`completionBonusPoints` breakdown (split from the single authoritative `pointsEarned`, not re-derived) so `rewards_history` gets one row per bonus category actually earned.

**Session-end wiring (Phase 4):** `POST /sessions/:id/end` (host-only) and the future auto-close sweep both call `apps/server/src/modules/sessions/end-session.ts`'s `endSession()` — the one place that closes every open `session_presence_intervals` row, runs `computeSessionRewards()`, and writes `session_participants` + `rewards_history` once. A participant already finalized inline (emergency exit) still has their presence intervals fed into the computation (their headcount still matters for everyone else's group bonus), just not re-written.

All rules above are confirmed final — see `docs/ARCHITECTURE.md` §7/§11.

## Stats/Streak/Milestone Accumulation (Phase 5)

Unlike the bonus computation above (pure functions, computed by Node and written once), streak/milestone/lifetime-aggregate accumulation is a **Postgres function**, `public.apply_session_stats(p_session_id, p_user_id, p_finalized_at, p_streak_grace_hours)` (`supabase/migrations/20260728160000_create_apply_session_stats_function.sql`). Why the split: `computeSessionRewards()` only ever needs data from the one session it's closing, so a pure Node function is the right shape. Accumulation needs to read-modify-write a *cross-session* row (`user_stats`, `user_streaks`) from **two independent Node call sites** (`end-session.ts` and `finalize-emergency-exit.ts`), either of which can race the sweep worker or each other for the same user across different sessions — a Node-side read-then-write has a lost-update window no application-level care closes. A single `SECURITY DEFINER` function does the whole read-decide-write cycle under row locks inside one transaction, the same precedent as `join_session()`/`rejoin_session()`.

Called once per finalized `session_participants` row, after that row (and its `rewards_history` base/bonus rows) already exist. Returns `'applied'` or `'skipped'` (exactly-once guard via `session_participants.stats_applied_at`, or the row not existing at all).

1. Lock the `session_participants` row; skip if missing or already applied.
2. Resolve the participant's **local day**: `(p_finalized_at at time zone coalesce(users.timezone, 'UTC'))::date` — an unrecognized/garbage timezone string falls back to UTC rather than aborting finalization.
3. Accumulate into `user_stats`: `total_minutes`, `total_points`, and whichever of `sessions_completed`/`sessions_emergency_exit`/`sessions_disconnected` matches `exit_reason`.
4. Upsert `user_stats_daily` for that local day.
5. **Streak** (`user_streaks`, any session with presence counts — `docs/RETENTION_STRATEGY.md` §1's forgiving-by-design decision): first-ever session starts it at 1; a later finalization timestamped *before* `last_session_at` (out-of-order — e.g. the sweep worker closing a stale interval after the participant already started a fresh session elsewhere) leaves the streak untouched entirely, stats still applied; the same local day as `last_session_day` doesn't double-count but still pushes `streak_grace_expires_at` forward; a gap within `STREAK_GRACE_HOURS` on a new day increments; a gap beyond it resets to 1. `longest_streak` is a monotonic high-water mark, never decremented here (only session-close code path — see the separate streak-expiry job below for how `current_streak` gets zeroed by the passage of time alone).
6. **Milestones**: `insert into user_milestones ... select ... where sessions_required <= (just-updated total) on conflict do nothing returning milestone_id`, looped — set-based and naturally idempotent, correctly handles crossing more than one tier in a single session. Each crossing writes one `rewards_history` row (`bonus_type='milestone'`) and folds `bonus_points` into `user_stats.total_points` in the same transaction — this is what keeps `total_points == sum(rewards_history.points)` true by construction rather than by convention.
7. Sets `stats_applied_at = p_finalized_at`.

**Streak expiry** is a separate concern from the above: nothing at session-close time can *break* a streak, since a break is caused by the passage of time, not an event. `apps/server/src/modules/stats/streak-expiry.ts`'s `runStreakExpiry()` — the same testable-core-plus-`setInterval` split as the Phase 4 sweep worker, on its own `STREAK_EXPIRY_INTERVAL_SECONDS` cadence (300s — no debounce-window concern the way host migration has, so it can run far less often) — delegates to `SessionsStore.expireStreaks(asOf)`, a single scoped `UPDATE ... SET current_streak = 0 WHERE streak_grace_expires_at < asOf AND current_streak > 0`. Deliberately a plain `service_role`-granted UPDATE, not a `SECURITY DEFINER` function: zeroing an already-expired streak has no atomicity concern the way `apply_session_stats()`'s cross-table read-decide-write does. `longest_streak` is never touched by this job — it's a monotonic high-water mark.

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
| `BLOCKED_APP_CATEGORIES` | `[Social Networking, Games, Entertainment]` | Fixed default-category blocklist, not per-session/per-user configurable; see `docs/ARCHITECTURE.md` §4 |
