// Unfriending is a direct client-side RLS delete (Phase 6.5 plan) — no
// Node round trip, the same posture as any other "no cross-row invariant
// to protect" removal. Mirrors user-profile.ts's ProfileResult convention.

const mockOr = jest.fn();
const mockDelete = jest.fn(() => ({ or: mockOr }));
const mockFrom = jest.fn(() => ({ delete: mockDelete }));

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { removeFriend } from './friends-repository';

describe('removeFriend', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockDelete.mockClear();
    mockOr.mockReset();
  });

  it('deletes the friendships row regardless of which slot each id is stored in', async () => {
    mockOr.mockResolvedValue({ error: null });

    const result = await removeFriend('user-1', 'user-2');

    expect(result).toEqual({ ok: true, value: null });
    expect(mockFrom).toHaveBeenCalledWith('friendships');
    expect(mockOr).toHaveBeenCalledWith(
      'and(user_id_a.eq.user-1,user_id_b.eq.user-2),and(user_id_a.eq.user-2,user_id_b.eq.user-1)',
    );
  });

  it('returns a typed failure on a Supabase error, never throwing', async () => {
    mockOr.mockResolvedValue({ error: { message: 'network error' } });

    const result = await removeFriend('user-1', 'user-2');

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});
