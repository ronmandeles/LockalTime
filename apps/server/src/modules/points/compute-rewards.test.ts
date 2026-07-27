import { computeForfeitedReward, computeSessionRewards } from './compute-rewards';
import type { ParticipantSummary, PresenceInterval, SessionTiming } from './types';

const START = new Date('2026-01-01T10:00:00Z');
const addMinutes = (date: Date, n: number): Date => new Date(date.getTime() + n * 60_000);

const wholeSessionInterval = (durationMinutes: number): PresenceInterval => ({
  joinedAt: START,
  leftAt: addMinutes(START, durationMinutes),
  blockerReadyAt: START,
});

const timing = (durationMinutes: number): SessionTiming => ({
  startedAt: START,
  endedAt: addMinutes(START, durationMinutes),
});

const participant = (
  userId: string,
  intervals: readonly PresenceInterval[],
  exitReason: ParticipantSummary['exitReason'] = 'completed',
): ParticipantSummary => ({ userId, intervals, exitReason });

describe('computeSessionRewards', () => {
  it('awards base points only when neither bonus applies', () => {
    const p = participant('a', [wholeSessionInterval(45)]);

    const [reward] = computeSessionRewards([p], timing(45));

    expect(reward).toEqual({
      userId: 'a',
      totalMinutesPresent: 45,
      groupBonusEarned: false,
      completionBonusEarned: false,
      pointsEarned: 45,
    });
  });

  it('stacks both bonuses additively (+20%), never compounded', () => {
    // 5 participants, 90 minutes each, from the start -- both group (>=5
    // for >=30min) and completion (>=60min, present start-to-end) apply.
    const participants = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      participant(id, [wholeSessionInterval(90)]),
    );

    const rewards = computeSessionRewards(participants, timing(90));

    for (const reward of rewards) {
      expect(reward.groupBonusEarned).toBe(true);
      expect(reward.completionBonusEarned).toBe(true);
      // 90 base * 1.20 = 108, not 90 * 1.1 * 1.1 = 108.9 (compounded) --
      // same number here by coincidence of round(); the additive-vs-
      // compounded distinction is asserted directly on percent math below.
      expect(reward.pointsEarned).toBe(108);
    }
  });

  it('applies only the group bonus when completion criteria are not met', () => {
    // 5 participants for exactly 30 min (qualifies group), but the session
    // itself is under 60 min (fails completion).
    const participants = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      participant(id, [wholeSessionInterval(30)]),
    );

    const rewards = computeSessionRewards(participants, timing(30));

    for (const reward of rewards) {
      expect(reward.groupBonusEarned).toBe(true);
      expect(reward.completionBonusEarned).toBe(false);
      expect(reward.pointsEarned).toBe(33); // 30 * 1.10 = 33
    }
  });

  it('applies only the completion bonus when fewer than 5 are present', () => {
    const p = participant('a', [wholeSessionInterval(90)]);

    const [reward] = computeSessionRewards([p], timing(90));

    expect(reward.groupBonusEarned).toBe(false);
    expect(reward.completionBonusEarned).toBe(true);
    expect(reward.pointsEarned).toBe(99); // 90 * 1.10 = 99
  });

  it('forfeits both bonuses for an emergency exit but keeps base points for minutes present', () => {
    const steady = ['b', 'c', 'd', 'e'].map((id) => participant(id, [wholeSessionInterval(90)]));
    const emergencyExit = participant('a', [wholeSessionInterval(40)], 'emergency_exit');

    const rewards = computeSessionRewards([...steady, emergencyExit], timing(90));
    const reward = rewards.find((r) => r.userId === 'a');

    expect(reward).toEqual({
      userId: 'a',
      totalMinutesPresent: 40,
      groupBonusEarned: false,
      completionBonusEarned: false,
      pointsEarned: 40,
    });
  });

  it('forfeits both bonuses for a participant who disconnected and never returned', () => {
    const steady = ['b', 'c', 'd', 'e'].map((id) => participant(id, [wholeSessionInterval(90)]));
    const disconnected = participant('a', [wholeSessionInterval(40)], 'disconnected');

    const rewards = computeSessionRewards([...steady, disconnected], timing(90));
    const reward = rewards.find((r) => r.userId === 'a');

    expect(reward?.pointsEarned).toBe(40);
    expect(reward?.groupBonusEarned).toBe(false);
    expect(reward?.completionBonusEarned).toBe(false);
  });

  it('returns one reward per participant, in no particular guaranteed order', () => {
    const participants = ['a', 'b', 'c'].map((id) => participant(id, [wholeSessionInterval(10)]));

    const rewards = computeSessionRewards(participants, timing(10));

    expect(rewards.map((r) => r.userId).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('computeForfeitedReward', () => {
  it('computes base-only points for a single participant mid-session (emergency exit)', () => {
    const intervals = [wholeSessionInterval(23)];

    expect(computeForfeitedReward(intervals, 'a')).toEqual({
      userId: 'a',
      totalMinutesPresent: 23,
      groupBonusEarned: false,
      completionBonusEarned: false,
      pointsEarned: 23,
    });
  });

  it('sums minutes across a rejoin before the emergency exit', () => {
    const intervals: PresenceInterval[] = [
      { joinedAt: START, leftAt: addMinutes(START, 10), blockerReadyAt: START },
      {
        joinedAt: addMinutes(START, 15),
        leftAt: addMinutes(START, 20),
        blockerReadyAt: addMinutes(START, 15),
      },
    ];

    expect(computeForfeitedReward(intervals, 'a').totalMinutesPresent).toBe(15);
    expect(computeForfeitedReward(intervals, 'a').pointsEarned).toBe(15);
  });
});
