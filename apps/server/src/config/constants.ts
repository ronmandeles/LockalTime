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
