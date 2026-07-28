import { STREAK_GRACE_HOURS } from '../../config/constants';
import { computeForfeitedReward } from '../points/compute-rewards';
import type { SessionsStore } from './sessions-store';

// Money-equivalent logic (ARCHITECTURE.md §3/§7): writes the
// session_participants + rewards_history rows for a participant's own
// emergency exit, immediately at their leave call rather than waiting for
// the session to end — both bonuses are forfeited unconditionally per §7,
// so this never needs the rest of the session's data the way
// end-session.ts's full finalization does. Called from sessions.router.ts
// only after closeOpenInterval() has already closed this user's interval
// with disconnect_reason='emergency_exit'.
export const finalizeEmergencyExit = async (
  store: SessionsStore,
  sessionId: string,
  userId: string,
  // Injectable clock (testing-standards skill), same pattern as
  // end-session.ts — Phase 5's apply_session_stats() call needs a
  // deterministic finalized-at timestamp for its local-day bucketing.
  now: () => Date = () => new Date(),
): Promise<void> => {
  const [session, intervals] = await Promise.all([
    store.getSessionSummary(sessionId),
    store.getUserPresenceIntervals(sessionId, userId),
  ]);

  const reward = computeForfeitedReward(
    intervals.map((row) => ({
      joinedAt: new Date(row.joinedAt),
      // Always closed by the time this runs — closeOpenInterval() closed
      // it before finalizeEmergencyExit() was ever called.
      leftAt: new Date(row.leftAt as string),
      blockerReadyAt: row.blockerReadyAt === null ? null : new Date(row.blockerReadyAt),
    })),
    userId,
  );

  await store.writeSessionParticipants(sessionId, [
    {
      userId,
      isHost: session?.hostId === userId,
      exitReason: 'emergency_exit',
      totalMinutesPresent: reward.totalMinutesPresent,
      groupBonusEarned: false,
      completionBonusEarned: false,
      pointsEarned: reward.pointsEarned,
    },
  ]);
  await store.insertRewardsHistory([
    { userId, sessionId, points: reward.pointsEarned, bonusType: 'base' },
  ]);

  await store.applySessionStats(sessionId, userId, now().toISOString(), STREAK_GRACE_HOURS);
};
