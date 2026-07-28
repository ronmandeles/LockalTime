import { getSupabaseClient } from './supabase-client';

// Unfriending is a direct client-side RLS delete (Phase 6.5 plan) — no
// Node round trip, no cross-row invariant to protect on removal, the
// friendships table's own RLS delete policy ("either party can remove a
// friendship") already scopes this correctly. Mirrors user-profile.ts's
// ProfileResult<T> convention: a typed result, never a throw.

export interface FriendsRepositoryFailure {
  readonly message: string;
}

export type FriendsRepositoryResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: FriendsRepositoryFailure };

export const removeFriend = async (
  userId: string,
  friendId: string,
): Promise<FriendsRepositoryResult<null>> => {
  const { error } = await getSupabaseClient()
    .from('friendships')
    .delete()
    .or(`and(user_id_a.eq.${userId},user_id_b.eq.${friendId}),and(user_id_a.eq.${friendId},user_id_b.eq.${userId})`);

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: null };
};
