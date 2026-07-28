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

// Phase 6 task 2 (owner decision): a verified host's static_qr/venue
// session expects materially more concurrent people than a friend-group
// session — a busy cafe's foot traffic, not five friends. A separate,
// higher, tunable constant rather than a per-venue DB column: simplest
// MVP shape (tune here, no migration needed), used wherever
// type === 'static_qr' (join-venue-session.ts's capacity check).
export const VENUE_SESSION_MAX_PARTICIPANTS = 200;

// Phase 6 task 5 (B2B metrics, ARCHITECTURE.md §10): the trailing window
// "average session duration per customer" is computed over. 30 days is
// long enough to stay meaningful for a venue with light foot traffic,
// short enough that the number keeps moving month to month (an all-time
// average would go stale and stop being actionable).
export const VENUE_METRICS_WINDOW_DAYS = 30;

// Phase 6 tasks 8-9 (attestation/device-trust): built-but-inert by design.
// There is no real monitor-mode data to threshold against yet — Phase 2's
// attestation pipeline still runs unconfiguredAttestationProvider (every
// verdict reads 'not_configured'), so "turning enforcement on" today would
// mean acting on a placeholder, not real signal. Flipping this to true is
// the ONE change needed once real Play Integrity/App Attest credentials
// exist and monitor-mode data has actually been analyzed — every other
// piece (schema, trust-tier mapping, group-bonus/streak gating) is already
// wired and tested against this flag both ways.
export const ATTESTATION_ENFORCEMENT_ENABLED = false;

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

// Gamification & stats (ARCHITECTURE.md §9, docs/RETENTION_STRATEGY.md §1,
// Phase 5) — consumed by end-session.ts / finalize-emergency-exit.ts when
// calling apply_session_stats(), and by the streak-expiry job below.
export const STREAK_GRACE_HOURS = 48;
// Streak-expiry job (streak-expiry.ts) cadence — nothing at session-close
// time can BREAK a streak (a break is caused by the passage of time, not
// an event), so this poller is what actually zeroes current_streak once
// streak_grace_expires_at passes. No debounce-window concern the way
// SESSION_SWEEP_INTERVAL_SECONDS has (host migration) -- a slower cadence
// here only means a broken streak is detected slightly later, not any
// correctness issue, so it runs far less often.
export const STREAK_EXPIRY_INTERVAL_SECONDS = 300;

// Phase 5.5 (Push Notification Infrastructure, docs/RETENTION_STRATEGY.md
// §5) — owner decision: the streak-risk push fires once
// streak_grace_expires_at is within this many hours (~12.5% of
// STREAK_GRACE_HOURS — late enough that most people who were going to have
// a session today already did, early enough to still act on it). Consumed
// by claim_streak_risk_notifications() via streak-risk-notifier.ts.
export const STREAK_RISK_NOTIFICATION_WINDOW_HOURS = 6;
// Dispatch cadence — same reasoning as STREAK_EXPIRY_INTERVAL_SECONDS: no
// debounce-window concern (the claim function itself is what prevents a
// double-send), just "don't hammer the DB".
export const STREAK_RISK_NOTIFICATION_INTERVAL_SECONDS = 300;

// Phase 6.5 (Social & Comparison Surfaces) — GET /friends/search's floor.
// A proportionate mitigation against trivially enumerating the whole
// username space one character at a time, not full abuse-prevention
// infra. Consumed by friends.router.ts.
export const MIN_FRIEND_SEARCH_QUERY_LENGTH = 2;

// Phase 7 (Release Prep) API hardening — src/middleware/security.ts.
// A single per-IP window applied to every route except /health (PaaS
// liveness checks must never 429). 100 req/15 min is generous for a real
// user driving the app by hand, tight enough to blunt a scripted client
// hammering session-join or friend-search enumeration.
export const RATE_LIMIT_WINDOW_MINUTES = 15;
export const RATE_LIMIT_MAX_REQUESTS = 100;
