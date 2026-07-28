import { z } from 'zod';

// Fail-fast config (.claude/skills/api-design/SKILL.md): every env var the
// server needs is validated once, at boot, so a missing/malformed value
// crashes immediately with a clear message instead of surfacing later as a
// confusing runtime error deep in a request handler.
const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  // Signs/verifies dynamic_qr session tokens (money-equivalent logic —
  // ARCHITECTURE.md §3/§7). No auth secret lives here: Supabase signs
  // access tokens asymmetrically and require-auth verifies them against
  // its public JWKS (services/supabase-jwks.ts), not a shared secret.
  QR_SIGNING_SECRET: z.string().min(1),
  PORT: z.coerce.number().int().positive().default(3000),
  // Phase 7 (Release Prep): crash/error monitoring. Optional and undefined
  // by default -- no Sentry account exists yet (same posture as
  // unconfiguredNotificationSender/unconfiguredAttestationProvider).
  // services/monitoring.ts's createMonitoring() no-ops entirely when this
  // is absent; setting it in production activates real reporting with no
  // code change.
  SENTRY_DSN: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

// Pure function: takes a source object rather than reading process.env
// itself, so callers (and tests) control exactly what it sees.
export const loadEnv = (source: Record<string, string | undefined>): Env => {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid server configuration — ${details}`);
  }
  return result.data;
};
