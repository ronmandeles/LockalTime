import { computeForfeitedReward, computeSessionRewards } from './compute-rewards';
import type { ParticipantSummary, PresenceInterval, SessionTiming } from './types';

const START = new Date('2026-01-01T10:00:00Z');
const addMinutes = (date: Date, n: number): Date => new Date(date.getTime() + n * 60_000);

const wholeSessionInterval = (durationMinutes: number): PresenceInterval => ({
  joinedAt: START,
  leftAt: addMinutes(START, durationMinutes),
  blockerReadyAt: START,
  deviceTrusted: true,
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
      basePoints: 45,
      groupBonusEarned: false,
      groupBonusPoints: 0,
      completionBonusEarned: false,
      completionBonusPoints: 0,
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
      expect(reward.basePoints).toBe(90);
      // Both bonuses earned: the 18-point combined bonus (108 - 90) is
      // split evenly between the two rows (equal 10% weights), remainder
      // to group_bonus -- an allocation convention for rewards_history's
      // separate rows, not a re-derivation of the authoritative total.
      expect(reward.groupBonusPoints).toBe(9);
      expect(reward.completionBonusPoints).toBe(9);
      expect(reward.groupBonusPoints + reward.completionBonusPoints).toBe(
        reward.pointsEarned - reward.basePoints,
      );
    }
  });

  it('splits an odd combined bonus with the remainder going to the group bonus row', () => {
    // base=65 -> pointsEarned = round(65 * 1.20) = 78, totalBonus = 13
    // (odd) -- floor(13/2)=6 to completion, the remaining 7 to group.
    const participants = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      participant(id, [wholeSessionInterval(65)]),
    );

    const rewards = computeSessionRewards(participants, timing(65));
    const [reward] = rewards;
    if (reward === undefined) {
      throw new Error('expected at least one reward');
    }

    expect(reward.groupBonusEarned).toBe(true);
    expect(reward.completionBonusEarned).toBe(true);
    expect(reward.pointsEarned).toBe(78);
    expect(reward.groupBonusPoints).toBe(7);
    expect(reward.completionBonusPoints).toBe(6);
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
      basePoints: 40,
      groupBonusEarned: false,
      groupBonusPoints: 0,
      completionBonusEarned: false,
      completionBonusPoints: 0,
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
      basePoints: 23,
      groupBonusEarned: false,
      groupBonusPoints: 0,
      completionBonusEarned: false,
      completionBonusPoints: 0,
      pointsEarned: 23,
    });
  });

  it('sums minutes across a rejoin before the emergency exit', () => {
    const intervals: PresenceInterval[] = [
      {
        joinedAt: START,
        leftAt: addMinutes(START, 10),
        blockerReadyAt: START,
        deviceTrusted: true,
      },
      {
        joinedAt: addMinutes(START, 15),
        leftAt: addMinutes(START, 20),
        blockerReadyAt: addMinutes(START, 15),
        deviceTrusted: true,
      },
    ];

    expect(computeForfeitedReward(intervals, 'a').totalMinutesPresent).toBe(15);
    expect(computeForfeitedReward(intervals, 'a').pointsEarned).toBe(15);
  });
});
