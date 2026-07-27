import {
  BASE_POINTS_PER_MINUTE,
  COMPLETION_BONUS_PERCENT,
  GROUP_BONUS_PERCENT,
} from '../../config/constants';
import { computeTotalMinutesPresent } from './base-points';
import { computeCompletionBonusEligibility } from './completion-bonus';
import { computeGroupBonusEligibility } from './group-bonus';
import type {
  ParticipantReward,
  ParticipantSummary,
  PresenceInterval,
  SessionTiming,
} from './types';

// Both bonuses are percentages of the base added together before a single
// rounding pass (e.g. both earned = 120% of base), never compounded
// (DATABASE.md "Bonus Computation" step 5, ARCHITECTURE.md §7 "Stacking").
// Rounding once at the end (rather than rounding each bonus separately and
// summing) avoids compounding rounding drift across the two bonuses.
const applyBonusPercent = (basePoints: number, bonusPercent: number): number =>
  Math.round((basePoints * (100 + bonusPercent)) / 100);

// Splits the combined bonus (already rounded once, above) back into its two
// rewards_history rows. This is an allocation for display/audit purposes,
// not a re-derivation of pointsEarned — the two parts always sum back to
// exactly totalBonusPoints by construction. Equal 10%/10% weights split
// evenly; an odd remainder goes to the group bonus row (arbitrary but
// deterministic, so the same inputs always produce the same split).
const splitBonusPoints = (
  totalBonusPoints: number,
  groupBonusEarned: boolean,
  completionBonusEarned: boolean,
): { groupBonusPoints: number; completionBonusPoints: number } => {
  if (groupBonusEarned && completionBonusEarned) {
    const completionBonusPoints = Math.floor(totalBonusPoints / 2);
    return { groupBonusPoints: totalBonusPoints - completionBonusPoints, completionBonusPoints };
  }
  if (groupBonusEarned) {
    return { groupBonusPoints: totalBonusPoints, completionBonusPoints: 0 };
  }
  if (completionBonusEarned) {
    return { groupBonusPoints: 0, completionBonusPoints: totalBonusPoints };
  }
  return { groupBonusPoints: 0, completionBonusPoints: 0 };
};

const buildReward = (
  userId: string,
  totalMinutesPresent: number,
  groupBonusEarned: boolean,
  completionBonusEarned: boolean,
): ParticipantReward => {
  const basePoints = totalMinutesPresent * BASE_POINTS_PER_MINUTE;
  const bonusPercent =
    (groupBonusEarned ? GROUP_BONUS_PERCENT : 0) +
    (completionBonusEarned ? COMPLETION_BONUS_PERCENT : 0);
  const pointsEarned = applyBonusPercent(basePoints, bonusPercent);
  const { groupBonusPoints, completionBonusPoints } = splitBonusPoints(
    pointsEarned - basePoints,
    groupBonusEarned,
    completionBonusEarned,
  );

  return {
    userId,
    totalMinutesPresent,
    basePoints,
    groupBonusEarned,
    groupBonusPoints,
    completionBonusEarned,
    completionBonusPoints,
    pointsEarned,
  };
};

// Money-equivalent logic (ARCHITECTURE.md §3/§7): the one function the
// session-end endpoint calls to turn a session's full presence history into
// every participant's final point total. Never computed client-side, never
// recomputed on read (DATABASE.md "Bonus Computation") — the caller writes
// this output once into session_participants + rewards_history.
export const computeSessionRewards = (
  participants: readonly ParticipantSummary[],
  timing: SessionTiming,
): readonly ParticipantReward[] => {
  const groupEligible = computeGroupBonusEligibility(participants);
  const completionEligible = computeCompletionBonusEligibility(participants, timing);

  return participants.map((participant) =>
    buildReward(
      participant.userId,
      computeTotalMinutesPresent(participant.intervals),
      groupEligible.has(participant.userId),
      completionEligible.has(participant.userId),
    ),
  );
};

// Money-equivalent logic (ARCHITECTURE.md §3/§7): a participant who
// emergency-exits (or is reconciled as 'disconnected') forfeits both
// bonuses unconditionally — no need for the full session's other
// participants or a defined session end, so this is finalized inline at
// their own leave/reconciliation moment rather than waiting for the
// session to close (§7 "Emergency exit").
export const computeForfeitedReward = (
  intervals: readonly PresenceInterval[],
  userId: string,
): ParticipantReward => buildReward(userId, computeTotalMinutesPresent(intervals), false, false);
