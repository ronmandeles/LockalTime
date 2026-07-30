import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../middleware/api-error';

export type UserRole = 'user' | 'verified_host' | 'admin';

const VALID_ROLES: ReadonlySet<string> = new Set<UserRole>(['user', 'verified_host', 'admin']);

// Thin persistence seam over public.users, same shape as SessionsStore
// (sessions-store.ts) -- the first Node read of this table (Phase 6 task
// 0). No unit test here: this codebase's convention (sessions-store.ts,
// attestation-store.ts) is that a createSupabase*Store adapter is proven
// by the real integration suite against the live local stack, not by
// mocking the Supabase query-builder chain -- see
// apps/server/integration/users.integration.test.ts.
export interface UsersStore {
  getUserRole(userId: string): Promise<UserRole>;
  // Phase 7 (Release Prep): the App Store/Play Store-mandated account
  // deletion path. Deletes the auth.users row via the admin API (requires
  // the service-role client -- an anon/user-scoped client has no
  // auth.admin surface); every dependent table cascades via its existing
  // `on delete cascade` FK, so this is the one call that needs to exist.
  deleteAccount(userId: string): Promise<void>;
}

export const createSupabaseUsersStore = (client: SupabaseClient): UsersStore => ({
  async getUserRole(userId) {
    const { data, error } = await client
      .from('users')
      .select('role')
      .eq('id', userId)
      .maybeSingle<{ role: string }>();

    if (error !== null) {
      throw new ApiError(500, 'user_role_lookup_failed', error.message);
    }
    if (data === null) {
      throw new ApiError(404, 'user_not_found', 'No users row for this id');
    }
    // Boundary validation (.claude/skills/typescript-strictness/SKILL.md):
    // never trust the DB's CHECK constraint alone via an unchecked `as` --
    // a schema drift here should fail loudly, not silently widen
    // requireRole()'s allowed set to an unrecognized string.
    if (!VALID_ROLES.has(data.role)) {
      throw new ApiError(500, 'user_role_lookup_failed', `Unrecognized role value: ${data.role}`);
    }
    return data.role as UserRole;
  },

  async deleteAccount(userId) {
    const { error } = await client.auth.admin.deleteUser(userId);
    // Idempotent by design: a client retry (e.g. a network timeout on a
    // first call that actually succeeded server-side) must not surface as
    // a failure when the desired end state -- this account no longer
    // exists -- is already true.
    if (error !== null && error.code !== 'user_not_found') {
      throw new ApiError(500, 'account_deletion_failed', error.message);
    }
  },
});
