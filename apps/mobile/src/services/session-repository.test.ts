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

const mockFrom = jest.fn((table: string) => {
  if (table === 'sessions') {
    return { select: mockSelect };
  }
  return { select: mockSelectPresence };
});

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import { fetchOpenPresenceIntervals, fetchSession } from './session-repository';

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
