import { GROUP_BONUS_MIN_MINUTES, GROUP_BONUS_MIN_PARTICIPANTS } from '../../config/constants';
import type { ParticipantSummary, PresenceInterval } from './types';

interface TimelineEvent {
  readonly time: number;
  readonly delta: 1 | -1;
}

interface Streak {
  readonly start: number;
  readonly end: number;
}

const GROUP_BONUS_MIN_MS = GROUP_BONUS_MIN_MINUTES * 60_000;

// Classic sweep-line over every participant's "counted" span (same
// technique as "meeting rooms II"): each span contributes a +1 at
// blockerReadyAt and a -1 at leftAt, and walking the sorted events
// reconstructs the concurrent-count-over-time step function without ever
// materializing a per-second array. An interval whose blocker never
// confirmed ready contributes no event at all — it can never push the
// count toward the threshold (ARCHITECTURE.md §7's Sybil-resistance gate).
// -1 events are processed before +1 events at an identical timestamp, so a
// simultaneous departure+arrival never registers a spurious instantaneous
// peak.
const findQualifyingStreaks = (allIntervals: readonly PresenceInterval[]): Streak[] => {
  const events: TimelineEvent[] = [];
  for (const interval of allIntervals) {
    if (interval.blockerReadyAt === null) {
      continue;
    }
    events.push({ time: interval.blockerReadyAt.getTime(), delta: 1 });
    events.push({ time: interval.leftAt.getTime(), delta: -1 });
  }
  events.sort((a, b) => a.time - b.time || a.delta - b.delta);

  const streaks: Streak[] = [];
  let count = 0;
  let streakStart: number | null = null;
  for (const event of events) {
    const wasQualifying = count >= GROUP_BONUS_MIN_PARTICIPANTS;
    count += event.delta;
    const isQualifying = count >= GROUP_BONUS_MIN_PARTICIPANTS;

    if (!wasQualifying && isQualifying) {
      streakStart = event.time;
    } else if (wasQualifying && !isQualifying && streakStart !== null) {
      streaks.push({ start: streakStart, end: event.time });
      streakStart = null;
    }
  }
  // No trailing open streak is possible: every interval passed in is
  // already closed (see PresenceInterval's doc comment), so every +1 has a
  // matching -1 and `count` always returns to 0.

  return streaks.filter((streak) => streak.end - streak.start >= GROUP_BONUS_MIN_MS);
};

// Money-equivalent logic (ARCHITECTURE.md §3/§7): which participants earn
// the +10% Group Bonus. DATABASE.md "Bonus Computation" steps 1-3.
export const computeGroupBonusEligibility = (
  participants: readonly ParticipantSummary[],
): ReadonlySet<string> => {
  const allIntervals = participants.flatMap((participant) => participant.intervals);
  const streaks = findQualifyingStreaks(allIntervals);
  if (streaks.length === 0) {
    return new Set();
  }

  const eligible = new Set<string>();
  for (const participant of participants) {
    // Emergency exit / disconnected: forfeits unconditionally, regardless
    // of how close they were to qualifying (§7).
    if (participant.exitReason !== 'completed') {
      continue;
    }
    for (const interval of participant.intervals) {
      if (interval.blockerReadyAt === null) {
        continue;
      }
      const readyAt = interval.blockerReadyAt.getTime();
      const leftAt = interval.leftAt.getTime();
      const qualifies = streaks.some((streak) => {
        const overlapStart = Math.max(readyAt, streak.start);
        const overlapEnd = Math.min(leftAt, streak.end);
        return overlapEnd - overlapStart >= GROUP_BONUS_MIN_MS;
      });
      if (qualifies) {
        eligible.add(participant.userId);
        break;
      }
    }
  }
  return eligible;
};
