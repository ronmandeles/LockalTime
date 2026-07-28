import { runStreakExpiry } from './streak-expiry';
import { buildFakeSessionsStore } from '../sessions/test-support/fake-sessions-store';
import type { FakeStreak } from '../sessions/test-support/fake-sessions-store';

const NOW = new Date('2026-08-05T00:00:00.000Z');
const clock = () => NOW;
const addHours = (date: Date, n: number): string =>
  new Date(date.getTime() + n * 60 * 60_000).toISOString();

const streak = (overrides: Partial<FakeStreak> & { userId: string }): FakeStreak => ({
  currentStreak: 3,
  longestStreak: 5,
  streakGraceExpiresAt: addHours(NOW, -1), // expired by default
  ...overrides,
});

describe('runStreakExpiry', () => {
  it('zeroes current_streak once the grace window has passed', async () => {
    const store = buildFakeSessionsStore({
      streaks: [streak({ userId: 'user-1', streakGraceExpiresAt: addHours(NOW, -1) })],
    });

    await runStreakExpiry({ store, now: clock });

    expect(store.state.streaks[0]?.currentStreak).toBe(0);
  });

  it('does not touch a streak still inside its grace window', async () => {
    const store = buildFakeSessionsStore({
      streaks: [streak({ userId: 'user-1', streakGraceExpiresAt: addHours(NOW, 1) })],
    });

    await runStreakExpiry({ store, now: clock });

    expect(store.state.streaks[0]?.currentStreak).toBe(3);
  });

  it('never decrements longest_streak — only current_streak is time-decayed', async () => {
    const store = buildFakeSessionsStore({
      streaks: [
        streak({
          userId: 'user-1',
          currentStreak: 7,
          longestStreak: 10,
          streakGraceExpiresAt: addHours(NOW, -1),
        }),
      ],
    });

    await runStreakExpiry({ store, now: clock });

    expect(store.state.streaks[0]).toMatchObject({ currentStreak: 0, longestStreak: 10 });
  });

  it('leaves an already-zero streak alone (idempotent, not an error)', async () => {
    const store = buildFakeSessionsStore({
      streaks: [
        streak({ userId: 'user-1', currentStreak: 0, streakGraceExpiresAt: addHours(NOW, -100) }),
      ],
    });

    await expect(runStreakExpiry({ store, now: clock })).resolves.toBeUndefined();
    expect(store.state.streaks[0]?.currentStreak).toBe(0);
  });

  it('handles multiple users independently in one pass', async () => {
    const store = buildFakeSessionsStore({
      streaks: [
        streak({ userId: 'expired-user', streakGraceExpiresAt: addHours(NOW, -1) }),
        streak({ userId: 'active-user', streakGraceExpiresAt: addHours(NOW, 1) }),
      ],
    });

    await runStreakExpiry({ store, now: clock });

    const expired = store.state.streaks.find((row) => row.userId === 'expired-user');
    const active = store.state.streaks.find((row) => row.userId === 'active-user');
    expect(expired?.currentStreak).toBe(0);
    expect(active?.currentStreak).toBe(3);
  });
});
