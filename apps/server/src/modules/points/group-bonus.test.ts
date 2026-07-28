import { computeGroupBonusEligibility } from './group-bonus';
import type { ParticipantSummary, PresenceInterval } from './types';

const T0 = new Date('2026-01-01T10:00:00Z').getTime();
const minutes = (n: number): Date => new Date(T0 + n * 60_000);

// Every helper participant is "ready" (blocker confirmed) at joinedAt unless
// a test overrides it, since that's the common case and blockerReadyAt-gating
// itself gets its own dedicated test below.
const readyInterval = (
  joinedAtMin: number,
  leftAtMin: number,
  blockerReadyAtMin: number = joinedAtMin,
  deviceTrusted = true,
): PresenceInterval => ({
  joinedAt: minutes(joinedAtMin),
  leftAt: minutes(leftAtMin),
  blockerReadyAt: minutes(blockerReadyAtMin),
  deviceTrusted,
});

const participant = (
  userId: string,
  intervals: readonly PresenceInterval[],
  exitReason: ParticipantSummary['exitReason'] = 'completed',
): ParticipantSummary => ({ userId, intervals, exitReason });

// 5 participants present 0..40 (40 min, >= the 30 min floor) — all should
// qualify.
const fiveForForty = ['a', 'b', 'c', 'd', 'e'].map((id) => participant(id, [readyInterval(0, 40)]));

describe('computeGroupBonusEligibility', () => {
  it('grants the bonus to every participant in a streak of exactly 5 for >= 30 minutes', () => {
    const eligible = computeGroupBonusEligibility(fiveForForty);

    expect(eligible).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('grants nothing when the streak is exactly 4 participants (below the 5 floor)', () => {
    const four = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));

    expect(computeGroupBonusEligibility(four)).toEqual(new Set());
  });

  it('grants nothing when 5+ are present but for under 30 minutes', () => {
    const brief = ['a', 'b', 'c', 'd', 'e'].map((id) => participant(id, [readyInterval(0, 20)]));

    expect(computeGroupBonusEligibility(brief)).toEqual(new Set());
  });

  it('qualifies a streak of exactly 30 minutes (boundary is inclusive)', () => {
    const exact = ['a', 'b', 'c', 'd', 'e'].map((id) => participant(id, [readyInterval(0, 30)]));

    expect(computeGroupBonusEligibility(exact)).toEqual(new Set(['a', 'b', 'c', 'd', 'e']));
  });

  it('resets the clock fully when the count drops below 5, even briefly', () => {
    // a..e present 0..15 (15 min, count=5), then a leaves at 15 (count=4),
    // rejoins at 16 (count=5 again) for another 25 min (16..41). Each half
    // alone is under 30 min at count>=5 (15 and 25), and the drop means
    // they don't sum to 40 either (DATABASE.md: "no partial credit
    // banking") -- the group streak resets fully at the drop.
    const participants = [
      participant('a', [readyInterval(0, 15), readyInterval(16, 41)]),
      ...['b', 'c', 'd', 'e'].map((id) => participant(id, [readyInterval(0, 41)])),
    ];

    expect(computeGroupBonusEligibility(participants)).toEqual(new Set());
  });

  it('does not reset the clock when count stays >= 5 after one of 6 leaves', () => {
    // 6 present 0..10, one (f) leaves at 10 leaving 5 for 10..40 (30 min at
    // count=5 exactly) — the remaining 5's clock should NOT have been reset
    // by f's departure, since count never dropped below 5.
    const remaining = ['a', 'b', 'c', 'd', 'e'].map((id) =>
      participant(id, [readyInterval(0, 40)]),
    );
    const f = participant('f', [readyInterval(0, 10)]);

    expect(computeGroupBonusEligibility([...remaining, f])).toEqual(
      new Set(['a', 'b', 'c', 'd', 'e']),
    );
  });

  it('qualifies a participant who joins mid-streak and stays unbroken for the remaining 30 minutes', () => {
    // a..d present the whole time (0..60). e joins (ready) at 20, stays to
    // 60 — that's 40 min of personal overlap with a qualifying streak, so e
    // should qualify too.
    const steady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 60)]));
    const lateJoiner = participant('e', [readyInterval(20, 60)]);

    expect(computeGroupBonusEligibility([...steady, lateJoiner])).toContain('e');
  });

  it('excludes a participant whose own overlap with the streak is under 30 minutes even though the streak qualifies', () => {
    // a..d present 0..60 (a full 60-minute streak once e joins). e joins at
    // 50 and stays to 60 -- only 10 minutes of personal overlap.
    const steady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 60)]));
    const briefJoiner = participant('e', [readyInterval(50, 60)]);

    const eligible = computeGroupBonusEligibility([...steady, briefJoiner]);

    expect(eligible.has('e')).toBe(false);
  });

  it('breaks personal eligibility on a disconnect/rejoin gap even if the group streak survives', () => {
    // a..e (5 of them) present 0..50 the whole time -- alone already a
    // qualifying 50-minute streak, so it survives regardless of f. f is
    // present 0..20 and 21..44 -- two separate intervals whose overlap
    // with the streak is 20 min and 23 min, neither alone reaching 30,
    // even though they'd sum to 43 if the gap didn't matter.
    const steady = ['a', 'b', 'c', 'd', 'e'].map((id) => participant(id, [readyInterval(0, 50)]));
    const gappy = participant('f', [readyInterval(0, 20), readyInterval(21, 44)]);

    expect(computeGroupBonusEligibility([...steady, gappy]).has('f')).toBe(false);
  });

  it('never counts an interval toward the threshold until blocker setup is confirmed', () => {
    // e "joins" at 0 (tapped join) but the blocker only confirms ready at
    // 25 -- only a..d + e-from-25 are >= 5, giving just 15 min (25..40) at
    // count>=5, under the 30-min floor.
    const fourSteady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));
    const slowStart = participant('e', [readyInterval(0, 40, 25)]);

    expect(computeGroupBonusEligibility([...fourSteady, slowStart])).toEqual(new Set());
  });

  it('excludes an interval whose blocker never confirmed ready at all', () => {
    const fourSteady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));
    const neverReady: ParticipantSummary = participant('e', [
      { joinedAt: minutes(0), leftAt: minutes(40), blockerReadyAt: null, deviceTrusted: true },
    ]);

    // Only 4 ever actually count toward the threshold -- never qualifies.
    expect(computeGroupBonusEligibility([...fourSteady, neverReady])).toEqual(new Set());
  });

  it('forfeits the bonus entirely for an emergency-exit participant regardless of overlap', () => {
    const steady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));
    const emergencyExit = participant('e', [readyInterval(0, 40)], 'emergency_exit');

    expect(computeGroupBonusEligibility([...steady, emergencyExit]).has('e')).toBe(false);
  });

  it('forfeits the bonus entirely for a participant who disconnected and never returned', () => {
    const steady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));
    const disconnected = participant('e', [readyInterval(0, 40)], 'disconnected');

    expect(computeGroupBonusEligibility([...steady, disconnected]).has('e')).toBe(false);
  });

  describe('device trust (Phase 6 tasks 8-9)', () => {
    it("excludes an unverified participant's OWN group bonus eligibility even though the group otherwise qualifies", () => {
      // 5 trusted participants alone already qualify (a..e) -- f is
      // unverified and joins the same window, so the group still qualifies
      // via a..e, but f itself must not benefit from it.
      const fiveSteady = ['a', 'b', 'c', 'd', 'e'].map((id) =>
        participant(id, [readyInterval(0, 40)]),
      );
      const unverified = participant('f', [readyInterval(0, 40, 0, false)]);

      const eligible = computeGroupBonusEligibility([...fiveSteady, unverified]);

      expect(eligible.has('f')).toBe(false);
      expect(eligible.has('a')).toBe(true);
    });

    it('an unverified interval cannot push OTHER participants over the 5-participant threshold either', () => {
      // Only 4 trusted + 1 unverified — without the gate this would read as
      // 5 concurrent and everyone would qualify.
      const fourSteady = ['a', 'b', 'c', 'd'].map((id) => participant(id, [readyInterval(0, 40)]));
      const unverified = participant('e', [readyInterval(0, 40, 0, false)]);

      expect(computeGroupBonusEligibility([...fourSteady, unverified])).toEqual(new Set());
    });
  });
});
