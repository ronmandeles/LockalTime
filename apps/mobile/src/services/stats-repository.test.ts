// Phase 5 gamification reads — same RLS-protected direct-Supabase posture
// as session-repository.ts. Every number here is already computed
// server-side by apply_session_stats() (Money-Equivalent Logic Rule);
// these functions only read it back.

// user_stats chain: .select().eq().maybeSingle()
const mockStatsMaybeSingle = jest.fn();
const mockStatsEq = jest.fn(() => ({ maybeSingle: mockStatsMaybeSingle }));
const mockStatsSelect = jest.fn(() => ({ eq: mockStatsEq }));

// user_streaks chain: .select().eq().maybeSingle()
const mockStreakMaybeSingle = jest.fn();
const mockStreakEq = jest.fn(() => ({ maybeSingle: mockStreakMaybeSingle }));
const mockStreakSelect = jest.fn(() => ({ eq: mockStreakEq }));

// user_stats_daily chain: .select().eq().gte().order()
const mockDailyOrder = jest.fn();
const mockDailyGte = jest.fn(() => ({ order: mockDailyOrder }));
const mockDailyEq = jest.fn(() => ({ gte: mockDailyGte }));
const mockDailySelect = jest.fn(() => ({ eq: mockDailyEq }));

// milestones chain: .select().order()
const mockMilestonesOrder = jest.fn();
const mockMilestonesSelect = jest.fn(() => ({ order: mockMilestonesOrder }));

// user_milestones chain: .select().eq()
const mockAchievedEq = jest.fn();
const mockAchievedSelect = jest.fn(() => ({ eq: mockAchievedEq }));

// sessions (history) chain: every method returns the same builder except
// the final .limit(), which resolves — mirrors real supabase-js, where
// each filter/order call returns the same mutable builder ("this").
const historyBuilder = {
  select: jest.fn(),
  eq: jest.fn(),
  not: jest.fn(),
  in: jest.fn(),
  lt: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
};
historyBuilder.select.mockImplementation(() => historyBuilder);
historyBuilder.eq.mockImplementation(() => historyBuilder);
historyBuilder.not.mockImplementation(() => historyBuilder);
historyBuilder.in.mockImplementation(() => historyBuilder);
historyBuilder.lt.mockImplementation(() => historyBuilder);
historyBuilder.order.mockImplementation(() => historyBuilder);

const mockFrom = jest.fn((table: string) => {
  if (table === 'user_stats') {
    return { select: mockStatsSelect };
  }
  if (table === 'user_streaks') {
    return { select: mockStreakSelect };
  }
  if (table === 'user_stats_daily') {
    return { select: mockDailySelect };
  }
  if (table === 'milestones') {
    return { select: mockMilestonesSelect };
  }
  if (table === 'user_milestones') {
    return { select: mockAchievedSelect };
  }
  if (table === 'sessions') {
    return historyBuilder;
  }
  throw new Error(`unexpected table: ${table}`);
});

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => ({ from: mockFrom }),
}));

import {
  fetchDailyStats,
  fetchMilestoneProgress,
  fetchSessionHistory,
  fetchUserStats,
  fetchUserStreak,
} from './stats-repository';

const USER_ID = 'user-1';

describe('fetchUserStats', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockStatsMaybeSingle.mockReset();
  });

  it('queries user_stats filtered to the user', async () => {
    const row = { total_minutes: 90, total_points: 90, sessions_completed: 3 };
    mockStatsMaybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchUserStats(USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('user_stats');
    expect(mockStatsEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({ ok: true, value: row });
  });

  it('returns ok with null for a brand-new user with no row yet', async () => {
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await fetchUserStats(USER_ID);

    expect(result).toEqual({ ok: true, value: null });
  });

  it('returns a typed failure when Supabase returns an error', async () => {
    mockStatsMaybeSingle.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchUserStats(USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});

describe('fetchUserStreak', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockStreakMaybeSingle.mockReset();
  });

  it('queries user_streaks filtered to the user', async () => {
    const row = { current_streak: 4, longest_streak: 9, streak_grace_expires_at: null };
    mockStreakMaybeSingle.mockResolvedValue({ data: row, error: null });

    const result = await fetchUserStreak(USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('user_streaks');
    expect(mockStreakEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({ ok: true, value: row });
  });

  it('returns ok with null for a brand-new user with no row yet', async () => {
    mockStreakMaybeSingle.mockResolvedValue({ data: null, error: null });

    const result = await fetchUserStreak(USER_ID);

    expect(result).toEqual({ ok: true, value: null });
  });
});

describe('fetchDailyStats', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockDailyOrder.mockReset();
  });

  it('queries user_stats_daily from the given day forward, ascending', async () => {
    const rows = [{ day: '2026-08-01', minutes: 30, points: 30, sessions: 1 }];
    mockDailyOrder.mockResolvedValue({ data: rows, error: null });

    const result = await fetchDailyStats(USER_ID, '2026-07-30');

    expect(mockFrom).toHaveBeenCalledWith('user_stats_daily');
    expect(mockDailyEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(mockDailyGte).toHaveBeenCalledWith('day', '2026-07-30');
    expect(mockDailyOrder).toHaveBeenCalledWith('day', { ascending: true });
    expect(result).toEqual({ ok: true, value: rows });
  });

  it('returns an empty array, not an error, when there are no rows yet', async () => {
    mockDailyOrder.mockResolvedValue({ data: null, error: null });

    const result = await fetchDailyStats(USER_ID, '2026-07-30');

    expect(result).toEqual({ ok: true, value: [] });
  });
});

describe('fetchMilestoneProgress', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    mockMilestonesOrder.mockReset();
    mockAchievedEq.mockReset();
  });

  it('combines the global ladder with this user’s crossings', async () => {
    const milestones = [
      { id: 'm1', slug: 'sessions_5', sessions_required: 5, bonus_points: 50 },
      { id: 'm2', slug: 'sessions_10', sessions_required: 10, bonus_points: 100 },
    ];
    mockMilestonesOrder.mockResolvedValue({ data: milestones, error: null });
    mockAchievedEq.mockResolvedValue({ data: [{ milestone_id: 'm1' }], error: null });

    const result = await fetchMilestoneProgress(USER_ID);

    expect(mockFrom).toHaveBeenCalledWith('milestones');
    expect(mockFrom).toHaveBeenCalledWith('user_milestones');
    expect(mockAchievedEq).toHaveBeenCalledWith('user_id', USER_ID);
    expect(result).toEqual({
      ok: true,
      value: { milestones, achievedMilestoneIds: new Set(['m1']) },
    });
  });

  it('returns a typed failure if the milestones read fails', async () => {
    mockMilestonesOrder.mockResolvedValue({ data: null, error: { message: 'network error' } });
    mockAchievedEq.mockResolvedValue({ data: [], error: null });

    const result = await fetchMilestoneProgress(USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });

  it('returns a typed failure if the achieved-crossings read fails', async () => {
    mockMilestonesOrder.mockResolvedValue({ data: [], error: null });
    mockAchievedEq.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchMilestoneProgress(USER_ID);

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});

describe('fetchSessionHistory', () => {
  beforeEach(() => {
    mockFrom.mockClear();
    historyBuilder.select.mockClear();
    historyBuilder.eq.mockClear();
    historyBuilder.not.mockClear();
    historyBuilder.in.mockClear();
    historyBuilder.lt.mockClear();
    historyBuilder.order.mockClear();
    historyBuilder.limit.mockReset();
  });

  const rawRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'session-1',
    type: 'solo',
    started_at: '2026-08-01T10:00:00.000Z',
    ended_at: '2026-08-01T10:45:00.000Z',
    session_participants: [
      {
        exit_reason: 'completed',
        total_minutes_present: 45,
        points_earned: 45,
        group_bonus_earned: false,
        completion_bonus_earned: false,
      },
    ],
    ...overrides,
  });

  it('flattens the embedded session_participants array into a single row', async () => {
    historyBuilder.limit.mockResolvedValue({ data: [rawRow()], error: null });

    const result = await fetchSessionHistory(USER_ID, 'all');

    expect(mockFrom).toHaveBeenCalledWith('sessions');
    expect(historyBuilder.eq).toHaveBeenCalledWith('session_participants.user_id', USER_ID);
    expect(historyBuilder.not).toHaveBeenCalledWith('ended_at', 'is', null);
    expect(historyBuilder.order).toHaveBeenCalledWith('ended_at', { ascending: false });
    expect(historyBuilder.limit).toHaveBeenCalledWith(20);
    expect(result).toEqual({
      ok: true,
      value: [
        {
          id: 'session-1',
          type: 'solo',
          started_at: '2026-08-01T10:00:00.000Z',
          ended_at: '2026-08-01T10:45:00.000Z',
          exit_reason: 'completed',
          total_minutes_present: 45,
          points_earned: 45,
          group_bonus_earned: false,
          completion_bonus_earned: false,
        },
      ],
    });
  });

  it('filters to solo sessions with .eq, and to group sessions with .in', async () => {
    historyBuilder.limit.mockResolvedValue({ data: [], error: null });

    await fetchSessionHistory(USER_ID, 'solo');
    expect(historyBuilder.eq).toHaveBeenCalledWith('type', 'solo');

    historyBuilder.eq.mockClear();
    historyBuilder.limit.mockResolvedValue({ data: [], error: null });
    await fetchSessionHistory(USER_ID, 'group');
    expect(historyBuilder.in).toHaveBeenCalledWith('type', ['dynamic_qr', 'static_qr']);
  });

  it('applies no type filter for "all"', async () => {
    historyBuilder.limit.mockResolvedValue({ data: [], error: null });

    await fetchSessionHistory(USER_ID, 'all');

    expect(historyBuilder.eq).not.toHaveBeenCalledWith('type', expect.anything());
    expect(historyBuilder.in).not.toHaveBeenCalled();
  });

  it('passes a cursor through as a strictly-older ended_at filter', async () => {
    historyBuilder.limit.mockResolvedValue({ data: [], error: null });

    await fetchSessionHistory(USER_ID, 'all', '2026-08-01T10:45:00.000Z');

    expect(historyBuilder.lt).toHaveBeenCalledWith('ended_at', '2026-08-01T10:45:00.000Z');
  });

  it('omits the cursor filter on the first page', async () => {
    historyBuilder.limit.mockResolvedValue({ data: [], error: null });

    await fetchSessionHistory(USER_ID, 'all');

    expect(historyBuilder.lt).not.toHaveBeenCalled();
  });

  it('skips a row whose embedded participant is missing (defensive)', async () => {
    historyBuilder.limit.mockResolvedValue({
      data: [rawRow({ session_participants: [] })],
      error: null,
    });

    const result = await fetchSessionHistory(USER_ID, 'all');

    expect(result).toEqual({ ok: true, value: [] });
  });

  it('returns a typed failure when Supabase returns an error', async () => {
    historyBuilder.limit.mockResolvedValue({ data: null, error: { message: 'network error' } });

    const result = await fetchSessionHistory(USER_ID, 'all');

    expect(result).toEqual({ ok: false, error: { message: 'network error' } });
  });
});
