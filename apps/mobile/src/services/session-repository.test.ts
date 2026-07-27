// Session hydration reads directly from Supabase (RLS-protected, not the
// Node API): a session's status/shape is structural, not money-equivalent
// (.claude/skills/supabase-integration/SKILL.md — "direct client reads are
// allowed for read-only aggregates the user is entitled to see", and the
// is_session_participant() RLS policies from Phase 2 task 2.1 exist
// specifically to authorize this). "REST hydrate" in ARCHITECTURE.md §5
// means PostgREST via supabase-js, the same mechanism CDC resumes from.

const mockSingle = jest.fn();
const mockEq = jest.fn(() => ({ single: mockSingle }));
const mockSelect = jest.fn(() => ({ eq: mockEq }));

// session_presence_intervals chain: .select().eq().is().order()
const mockOrder = jest.fn();
const mockIs = jest.fn(() => ({ order: mockOrder }));
const mockEqPresence = jest.fn(() => ({ is: mockIs }));
const mockSelectPresence = jest.fn(() => ({ eq: mockEqPresence }));

// session_participants chain: .select().eq().eq().maybeSingle()
const mockMaybeSingle = jest.fn();
const mockEqParticipant2 = jest.fn(() => ({ maybeSingle: mockMaybeSingle }));
const mockEqParticipant1 = jest.fn(() => ({ eq: mockEqParticipant2 }));
const mockSelectParticipant = jest.fn(() => ({ eq: mockEqParticipant1 }));

// rewards_history chain: .select().eq().eq()
const mockEqRewards2 = jest.fn();
const mockEqRewards1 = jest.fn(() => ({ eq: mockEqRewards2 }));
const mockSelectRewards = jest.fn(() => ({ eq: mockEqRewards1 }));

const mockFrom = jest.fn((table: string) => {
  if (table === 'sessions') {
    return { select: mockSelect };
  }
  if (table === 'session_participants') {
    return { select: mockSelectParticipant };
  }
  if (table === 'rewards_history') {
    return { select: mockSelectRewards };
  }
  return { select: mockSelectPresence };
});

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import {
  fetchOpenPresenceIntervals,
  fetchRewardsHistory,
  fetchSession,
  fetchSessionParticipant,
} from './session-repository';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';

describe('fetchSession', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockSelect.mockClear();
    mockEq.mockClear();
    mockSingle.mockReset();
  });

  it('returns the session row on success', async () => {
    const row = { id: SESSION_ID, status: 'active' };
    mockSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchSession(SESSION_ID);

    expect(mockFrom).toHaveBeenCalledWith('sessions');
    expect(mockEq).toHaveBeenCalledWith('id', SESSION_ID);
    expect(result).toEqual({ ok: true, value: row });
  });

  it('returns a typed failure when Supabase returns an error (e.g. RLS denial)', async () => {
    mockSingle.mockResolvedValue({ data: null, error: { message: 'permission denied' } });

    const result = await fetchSession(SESSION_ID);

    expect(result).toEqual({ ok: false, error: { message: 'permission denied' } });
  });
});

describe('fetchOpenPresenceIntervals', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockOrder.mockReset();
  });

  it('queries session_presence_intervals filtered to this session with left_at null', async () => {
    const rows = [{ id: 'a', session_id: SESSION_ID, user_id: 'u1', left_at: null }];
    mockOrder.mockResolvedValue({ data: rows, error: null });

    const result = await fetchOpenPresenceIntervals(SESSION_ID);

    expect(mockFrom).toHaveBeenCalledWith('session_presence_intervals');
    expect(result).toEqual({ ok: true, value: rows });
  });

  it('returns a typed failure when Supabase returns an error', async () => {
    mockOrder.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchOpenPresenceIntervals(SESSION_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});

describe('fetchSessionParticipant', () => {
  const USER_ID = 'user-1';

  beforeEach(() => {
    mockFrom.mockClear();
    mockMaybeSingle.mockReset();
  });

  it('queries session_participants filtered to this session and user', async () => {
    const row = { session_id: SESSION_ID, user_id: USER_ID, points_earned: 47 };
    mockMaybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchSessionParticipant(SESSION_ID, USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('session_participants');
    expect(mockEqParticipant1).toHaveBeenCalledWith('session_id', SESSION_ID);
    expect(mockEqParticipant2).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({ ok: true, value: row });
  });

  it('returns ok with a null value when finalization has not landed yet (no row)', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await fetchSessionParticipant(SESSION_ID, USER_ID);

    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns a typed failure when Supabase returns an error', async () => {
    mockMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchSessionParticipant(SESSION_ID, USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});

describe('fetchRewardsHistory', () => {
  const USER_ID = 'user-1';

  beforeEach(() => {
    mockFrom.mockClear();
    mockEqRewards2.mockReset();
  });

  it('queries rewards_history filtered to this session and user', async () => {
    const rows = [
      { points: 30, bonus_type: 'base' },
      { points: 3, bonus_type: 'group_bonus' },
    ];
    mockEqRewards2.mockResolvedValue({ data: rows, error: null });

    const result = await fetchRewardsHistory(SESSION_ID, USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('rewards_history');
    expect(mockEqRewards1).toHaveBeenCalledWith('session_id', SESSION_ID);
    expect(mockEqRewards2).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({ ok: true, value: rows });
  });

  it('returns a typed failure when Supabase returns an error', async () => {
    mockEqRewards2.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchRewardsHistory(SESSION_ID, USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});
