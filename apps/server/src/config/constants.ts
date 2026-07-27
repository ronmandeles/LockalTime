// Tunable config constants, not hardcoded inline — see docs/DATABASE.md's
// "Config Constants" table, which this mirrors and must stay in sync with.

// How long a dynamic_qr session's signed token stays valid. The host can
// regenerate on demand (a fresh mint invalidates the old token — see
// qr-token.ts's nonce).
export const QR_TOKEN_TTL_MINUTES = 15;

// Server-enforced cap on concurrent (open-interval) participants in a
// session. Not yet a per-session/host-chosen value — DATABASE.md has no
// column for that and no product decision exists for a host-chosen cap;
// promoting this to a `sessions.max_participants` column is a small,
// backwards-compatible change if that decision is made later.
export const SESSION_MAX_PARTICIPANTS = 50;

// Points & bonus engine (ARCHITECTURE.md §7, DATABASE.md "Bonus
// Computation" — spec confirmed, §11). Consumed by src/modules/points/.
export const BASE_POINTS_PER_MINUTE = 1;
export const GROUP_BONUS_PERCENT = 10;
export const GROUP_BONUS_MIN_PARTICIPANTS = 5;
export const GROUP_BONUS_MIN_MINUTES = 30;
export const COMPLETION_BONUS_PERCENT = 10;
export const COMPLETION_BONUS_MIN_SESSION_MINUTES = 60;
export const COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS = 60;

// Session sweep worker (ARCHITECTURE.md §6, Phase 4 task 7) — host
// migration, stale-participant reconciliation, and auto-close, all driven
// by src/modules/sessions/sweep.ts on this cadence.
export const HOST_MIGRATION_PRESENCE_TIMEOUT_SECONDS = 20;
// Matches the native offline-cutoff grace period (§4) so a participant's
// own brief disconnect is never penalized before the same window the
// native layer is supposed to tolerate.
export const PARTICIPANT_PRESENCE_TIMEOUT_MINUTES = 30;
export const OPEN_ENDED_SESSION_MAX_HOURS = 24;
// How often the sweep runs. Short enough to keep host-migration's 20s
// debounce meaningful (a 60s sweep interval would make "detected within
// 20s" impossible in practice); long enough not to hammer the DB — this is
// an in-process poller (Phase 4 decision: no separate deployment/scheduling
// infra exists yet), not a distributed job queue.
export const SESSION_SWEEP_INTERVAL_SECONDS = 10;
