import express, { Express } from 'express';

import type { Env } from './config/env';
import { createRequireAuth } from './middleware/require-auth';
import { createRequireRole } from './middleware/require-role';
import { errorHandler } from './middleware/error-handler';
import { rateLimiter, securityHeaders } from './middleware/security';
import { unconfiguredAttestationProvider } from './modules/attestation/attestation-provider';
import { createSupabaseAttestationStore } from './modules/attestation/attestation-store';
import { createFriendsRouter } from './modules/friends/friends.router';
import { createSupabaseFriendsStore } from './modules/friends/friends-store';
import { createLegalRouter } from './modules/legal/legal.router';
import { createSessionsRouter } from './modules/sessions/sessions.router';
import { createSupabaseSessionsStore } from './modules/sessions/sessions-store';
import { createUsersRouter } from './modules/users/users.router';
import { createSupabaseUsersStore } from './modules/users/users-store';
import { createVenuesRouter } from './modules/venues/venues.router';
import { createSupabaseVenuesStore } from './modules/venues/venues-store';
import { getSupabaseAdminClient } from './services/supabase-admin';
import { createSupabaseJwks } from './services/supabase-jwks';

// env is threaded in explicitly (never read from process.env inside this
// module) so every route/middleware this factory wires up gets its config
// from one place, and tests can swap in a fixture without touching
// process.env (.claude/skills/testing-standards/SKILL.md: no test depends
// on ambient global state).
export function createApp(env: Env): Express {
  const app = express();
  app.use(securityHeaders);
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  // Mounted after /health so PaaS liveness checks are never rate-limited —
  // every route registered below this line is subject to the per-IP limit.
  app.use(rateLimiter);

  // Built once per app instance — createRemoteJWKSet caches the fetched
  // public key across requests, so every route sharing this instance
  // benefits from the same cache.
  const requireAuth = createRequireAuth(createSupabaseJwks(env.SUPABASE_URL));

  const adminClient = getSupabaseAdminClient(env);
  const sessionsStore = createSupabaseSessionsStore(adminClient);
  const attestationStore = createSupabaseAttestationStore(adminClient);
  const usersStore = createSupabaseUsersStore(adminClient);
  const venuesStore = createSupabaseVenuesStore(adminClient);
  const friendsStore = createSupabaseFriendsStore(adminClient);
  // Venues are a strictly B2B construct (ARCHITECTURE.md §10) — every
  // route that creates or lists them requires verified_host or admin.
  const requireVerifiedHost = createRequireRole(usersStore, ['verified_host', 'admin']);

  app.use(
    '/sessions',
    createSessionsRouter({
      store: sessionsStore,
      qrSigningSecret: env.QR_SIGNING_SECRET,
      requireAuth,
      attestationProvider: unconfiguredAttestationProvider,
      attestationStore,
      venuesStore,
    }),
  );
  app.use(
    '/venues',
    createVenuesRouter({
      store: venuesStore,
      sessionsStore,
      qrSigningSecret: env.QR_SIGNING_SECRET,
      requireAuth,
      requireVerifiedHost,
    }),
  );

  app.use(
    '/friends',
    createFriendsRouter({
      store: friendsStore,
      requireAuth,
    }),
  );

  app.use(
    '/account',
    createUsersRouter({
      store: usersStore,
      requireAuth,
    }),
  );

  app.use('/legal', createLegalRouter());

  // Must be registered last — Express identifies error-handling middleware
  // by its 4-argument arity, and only middleware registered after a route
  // sees errors that route passes to next().
  app.use(errorHandler);

  return app;
}
