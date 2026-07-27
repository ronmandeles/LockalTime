import {
  COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS,
  COMPLETION_BONUS_MIN_SESSION_MINUTES,
} from '../../config/constants';
import type { ParticipantSummary, SessionTiming } from './types';

// Money-equivalent logic (ARCHITECTURE.md §3/§7): which participants earn
// the +10% Completion Bonus. DATABASE.md "Bonus Computation" step 4 — all
// four conditions must hold: session ran long enough, joined at the start
// (practical tolerance), exactly one interval spanning start-to-end (any
// disconnect/rejoin gap disqualifies), and exit_reason is 'completed'.
export const computeCompletionBonusEligibility = (
  participants: readonly ParticipantSummary[],
  timing: SessionTiming,
): ReadonlySet<string> => {
  const sessionMinutes = (timing.endedAt.getTime() - timing.startedAt.getTime()) / 60_000;
  if (sessionMinutes < COMPLETION_BONUS_MIN_SESSION_MINUTES) {
    return new Set();
  }

  const eligible = new Set<string>();
  for (const participant of participants) {
    if (participant.exitReason !== 'completed') {
      continue;
    }
    if (participant.intervals.length !== 1) {
      continue;
    }
    const [only] = participant.intervals;
    if (only === undefined) {
      continue;
    }
    const joinDeltaSeconds = Math.abs(only.joinedAt.getTime() - timing.startedAt.getTime()) / 1000;
    if (joinDeltaSeconds > COMPLETION_BONUS_JOIN_TOLERANCE_SECONDS) {
      continue;
    }
    if (only.leftAt.getTime() < timing.endedAt.getTime()) {
      continue;
    }
    eligible.add(participant.userId);
  }
  return eligible;
};
