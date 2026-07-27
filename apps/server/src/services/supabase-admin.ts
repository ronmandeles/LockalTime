import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@supabase/supabase-js';

import type { Env } from '../config/env';

// The server's one Supabase client, built with the SERVICE ROLE key —
// bypasses RLS entirely, so every write it makes is one the Node API has
// already authorized itself (.claude/skills/supabase-integration/SKILL.md:
// this key never leaves the server). Memoized lazily, same pattern as the
// mobile app's getSupabaseClient() (apps/mobile/src/services/supabase-client.ts),
// so importing this module has no side effects on its own.
let memoizedClient: SupabaseClient | null = null;

export const getSupabaseAdminClient = (env: Env): SupabaseClient => {
  if (memoizedClient === null) {
    memoizedClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        // No end-user session to persist or refresh — this client acts as
        // the server itself, not on behalf of a signed-in user.
        autoRefreshToken: false,
        persistSession: false,
      },
    });
  }
  return memoizedClient;
};

// Test-only escape hatch: memoization is the one piece of module state in
// this file, and tests need to reset it between cases to assert the
// "constructs once" behavior deterministically.
export const resetSupabaseAdminClientForTests = (): void => {
  memoizedClient = null;
};
