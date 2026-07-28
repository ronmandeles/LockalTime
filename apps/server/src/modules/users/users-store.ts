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
});
