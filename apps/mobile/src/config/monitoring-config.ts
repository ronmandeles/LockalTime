// Phase 7 (Release Prep): crash/error monitoring. Empty by design — no
// Sentry account exists yet (CLAUDE.md's Phase 7 credentials track, same
// posture as push-registration.ts). services/monitoring.ts's
// initMonitoring() no-ops entirely when this is empty. A real per-
// environment value arrives with proper build-time config (Phase 7's
// staging-setup decision in CLAUDE.md already flags this file's sibling,
// supabase-config.ts, as hardcoded pending the same infrastructure) —
// until then, edit this constant directly for a real device test build.
export const SENTRY_DSN = '';
