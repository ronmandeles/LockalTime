import type { Env } from '../config/env';

// Shared valid Env fixture for tests that need a fully-parsed config object
// but aren't testing config parsing itself — that's env.test.ts's job, which
// deliberately keeps its own literal fixtures to exercise loadEnv directly.
export const TEST_ENV: Env = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  QR_SIGNING_SECRET: 'qr-signing-secret-at-least-32-characters-long',
  PORT: 3000,
};
