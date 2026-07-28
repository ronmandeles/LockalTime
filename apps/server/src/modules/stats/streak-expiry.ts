import type { SessionsStore } from '../sessions/sessions-store';

export interface StreakExpiryDeps {
  readonly store: SessionsStore;
  readonly now: () => Date;
}

// The one entry point the streak-expiry scheduler (server.ts) calls on a
// fixed cadence (STREAK_EXPIRY_INTERVAL_SECONDS). Deliberately thin: unlike
// runSweep() (sweep.ts), there's no per-session branching to do here — the
// entire job is "zero every streak whose grace window has passed", which
// is a single scoped UPDATE the store already expresses atomically
// (expireStreaks()). Kept as its own testable function rather than calling
// the store directly from server.ts for the same reason sweep.ts is split
// the way it is: this is the part covered by a unit test, the setInterval
// wiring around it is the untested runtime shell.
export const runStreakExpiry = async (deps: StreakExpiryDeps): Promise<void> => {
  await deps.store.expireStreaks(deps.now().toISOString());
};
