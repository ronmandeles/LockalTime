import dotenv from 'dotenv';

import { createApp } from './app';
import { loadEnv } from './config/env';
import { SESSION_SWEEP_INTERVAL_SECONDS, STREAK_EXPIRY_INTERVAL_SECONDS } from './config/constants';
import { createSupabaseSessionRealtimePort } from './modules/sessions/session-realtime-port';
import { createSupabaseSessionsStore } from './modules/sessions/sessions-store';
import { runSweep } from './modules/sessions/sweep';
import { runStreakExpiry } from './modules/stats/streak-expiry';
import { getSupabaseAdminClient } from './services/supabase-admin';

// Populates process.env from a local .env file (see .env.example) — a
// no-op if one isn't present, e.g. in CI, where the real env vars are set
// directly. Must run before loadEnv reads process.env below.
dotenv.config();

// The only place process.env is read directly — everything downstream
// receives the already-validated Env object (config/env.ts's fail-fast
// contract).
const env = loadEnv(process.env);

const app = createApp(env);

// Phase 4 decision (ARCHITECTURE.md §6, backlog.md task 7): the session
// sweep worker runs in-process rather than as a separate deployment, since
// no standalone scheduling infra exists yet. runSweep() itself is the
// testable core (sweep.ts, sweep.test.ts); this setInterval wiring is the
// untested runtime shell, same split as app.ts vs this file.
const adminClient = getSupabaseAdminClient(env);
const sweepDeps = {
  store: createSupabaseSessionsStore(adminClient),
  realtime: createSupabaseSessionRealtimePort(adminClient),
  now: () => new Date(),
};
setInterval(() => {
  runSweep(sweepDeps).catch((error: unknown) => {
    console.error('Session sweep tick failed', error);
  });
}, SESSION_SWEEP_INTERVAL_SECONDS * 1000);

// Phase 5 (docs/RETENTION_STRATEGY.md §1, backlog.md task 5): a streak
// breaks by the passage of time alone, not by any event apply_session_
// stats() sees — this separate, slower-cadence poller is what actually
// zeroes an expired current_streak. Shares the sweep worker's store
// instance; deliberately its own setInterval/its own testable core
// (streak-expiry.ts) rather than folded into runSweep(), since it has
// nothing to do with sessions at all.
setInterval(() => {
  runStreakExpiry(sweepDeps).catch((error: unknown) => {
    console.error('Streak expiry tick failed', error);
  });
}, STREAK_EXPIRY_INTERVAL_SECONDS * 1000);

app.listen(env.PORT, () => {
  console.log(`Lockal Time API listening on port ${env.PORT}`);
});
