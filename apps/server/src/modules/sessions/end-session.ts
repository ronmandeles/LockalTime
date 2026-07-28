import { STREAK_GRACE_HOURS } from '../../config/constants';
import { computeSessionRewards } from '../points/compute-rewards';
import type { ParticipantSummary, PresenceInterval } from '../points/types';
import type {
  BonusType,
  DisconnectReason,
  EndReason,
  ExitReason,
  FinalizedParticipantInput,
  PresenceIntervalRow,
  RewardsHistoryRowInput,
  SessionsStore,
} from './sessions-store';

export interface EndSessionActor {
  // The authenticated caller's user id for a host-triggered end, or null
  // for a system-triggered close (the Phase 4 auto-close sweep) — a null
  // actor bypasses the host-ownership check entirely, since there is no
  // caller to check it against.
  readonly endedBy: string | null;
  readonly endReason: EndReason;
}

export type EndSessionResult =
  | { readonly outcome: 'not_found' }
  | { readonly outcome: 'not_active' }
  | { readonly outcome: 'forbidden' }
  | { readonly outcome: 'ended'; readonly endedAt: string };

// A participant's newest interval tells us how the session ended for them:
// closed by THIS session-end pass ('session_ended') means they were still
// present -> 'completed'; closed earlier by their own choice
// ('emergency_exit') means they're already finalized elsewhere and this
// branch is only reached for the timeline reconstruction, never for
// writing; anything else (an 'involuntary_disconnect' the stale-interval
// reconciliation worker already closed, and they never rejoined) means
// they were gone by the end -> 'disconnected' (Phase 4's new exit_reason).
const deriveExitReason = (disconnectReason: DisconnectReason | null): ExitReason => {
  if (disconnectReason === 'session_ended') {
    return 'completed';
  }
  if (disconnectReason === 'emergency_exit') {
    return 'emergency_exit';
  }
  return 'disconnected';
};

const toPresenceInterval = (row: PresenceIntervalRow): PresenceInterval => ({
  joinedAt: new Date(row.joinedAt),
  // Every interval is closed by the time this runs (closeAllOpenIntervals
  // ran first) — a still-null leftAt here would be a store bug, not a
  // real state this function needs to model.
  leftAt: new Date(row.leftAt as string),
  blockerReadyAt: row.blockerReadyAt === null ? null : new Date(row.blockerReadyAt),
});

// Groups every interval by user and derives each user's final exit_reason
// from their most recently closed interval. Includes EVERY participant who
// ever had an interval, including ones already finalized elsewhere
// (emergency exit) — the group bonus's concurrent-count timeline needs
// their presence too, even though the caller won't write their row again.
const buildParticipantSummaries = (
  intervals: readonly PresenceIntervalRow[],
): readonly ParticipantSummary[] => {
  const byUser = new Map<string, PresenceIntervalRow[]>();
  for (const row of intervals) {
    const existing = byUser.get(row.userId);
    if (existing === undefined) {
      byUser.set(row.userId, [row]);
    } else {
      existing.push(row);
    }
  }

  return Array.from(byUser.entries()).map(([userId, userIntervals]) => {
    const newest = userIntervals.reduce((latest, candidate) =>
      new Date(candidate.leftAt ?? 0).getTime() > new Date(latest.leftAt ?? 0).getTime()
        ? candidate
        : latest,
    );
    return {
      userId,
      exitReason: deriveExitReason(newest.disconnectReason),
      intervals: userIntervals.map(toPresenceInterval),
    };
  });
};

const rewardToRewardsHistoryRows = (
  sessionId: string,
  userId: string,
  basePoints: number,
  groupBonusEarned: boolean,
  groupBonusPoints: number,
  completionBonusEarned: boolean,
  completionBonusPoints: number,
): RewardsHistoryRowInput[] => {
  const rows: { points: number; bonusType: BonusType }[] = [
    { points: basePoints, bonusType: 'base' },
  ];
  if (groupBonusEarned) {
    rows.push({ points: groupBonusPoints, bonusType: 'group_bonus' });
  }
  if (completionBonusEarned) {
    rows.push({ points: completionBonusPoints, bonusType: 'completion_bonus' });
  }
  return rows.map((row) => ({ userId, sessionId, points: row.points, bonusType: row.bonusType }));
};

// Money-equivalent logic (ARCHITECTURE.md §3/§7): the one entry point that
// closes out a session — closes every open interval, computes every
// not-yet-finalized participant's reward via points/compute-rewards.ts, and
// writes session_participants + rewards_history once. Called both by the
// host-triggered HTTP endpoint (sessions.router.ts) and by the Phase 4
// auto-close sweep (system-triggered, endedBy: null) — the only difference
// between the two is who's allowed to call it and what end_reason lands.
export const endSession = async (
  store: SessionsStore,
  sessionId: string,
  actor: EndSessionActor,
  // Injectable clock (testing-standards skill: never depend on wall-clock
  // time in tests) — defaults to the real clock in production. The same
  // `now` is used both to close intervals and as the completion bonus's
  // session end timestamp, so they're always consistent by construction.
  now: () => Date = () => new Date(),
): Promise<EndSessionResult> => {
  const session = await store.getSessionSummary(sessionId);
  if (session === null) {
    return { outcome: 'not_found' };
  }
  if (session.status !== 'active') {
    return { outcome: 'not_active' };
  }
  if (actor.endedBy !== null && session.hostId !== actor.endedBy) {
    return { outcome: 'forbidden' };
  }

  const endedAt = now().toISOString();
  await store.closeAllOpenIntervals(sessionId, endedAt);

  const [intervals, alreadyFinalized] = await Promise.all([
    store.getPresenceIntervals(sessionId),
    store.getFinalizedParticipantUserIds(sessionId),
  ]);

  const participants = buildParticipantSummaries(intervals);
  const rewards = computeSessionRewards(participants, {
    startedAt: new Date(session.startedAt ?? endedAt),
    endedAt: new Date(endedAt),
  });
  const exitReasonByUserId = new Map(participants.map((p) => [p.userId, p.exitReason]));

  const participantRows: FinalizedParticipantInput[] = [];
  const rewardsHistoryRows: RewardsHistoryRowInput[] = [];
  for (const reward of rewards) {
    if (alreadyFinalized.has(reward.userId)) {
      continue;
    }
    const exitReason = exitReasonByUserId.get(reward.userId) ?? 'disconnected';
    participantRows.push({
      userId: reward.userId,
      isHost: reward.userId === session.hostId,
      exitReason,
      totalMinutesPresent: reward.totalMinutesPresent,
      groupBonusEarned: reward.groupBonusEarned,
      completionBonusEarned: reward.completionBonusEarned,
      pointsEarned: reward.pointsEarned,
    });
    rewardsHistoryRows.push(
      ...rewardToRewardsHistoryRows(
        sessionId,
        reward.userId,
        reward.basePoints,
        reward.groupBonusEarned,
        reward.groupBonusPoints,
        reward.completionBonusEarned,
        reward.completionBonusPoints,
      ),
    );
  }

  await store.writeSessionParticipants(sessionId, participantRows);
  await store.insertRewardsHistory(rewardsHistoryRows);

  // Phase 5: accumulate each newly-finalized participant's row into their
  // lifetime stats/streak/milestones. Deliberately after the writes above —
  // apply_session_stats() reads the session_participants row this call just
  // wrote. Already-finalized participants (emergency exit) are excluded by
  // construction: participantRows never contains them (see the loop above),
  // since their own finalize-emergency-exit.ts call already applied stats
  // at their own exit moment.
  await Promise.all(
    participantRows.map((row) =>
      store.applySessionStats(sessionId, row.userId, endedAt, STREAK_GRACE_HOURS),
    ),
  );

  await store.markSessionEnded({
    sessionId,
    endedAt,
    endedBy: actor.endedBy,
    endReason: actor.endReason,
  });

  return { outcome: 'ended', endedAt };
};
