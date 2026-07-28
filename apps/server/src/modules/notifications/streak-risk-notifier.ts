import { getStreakRiskCopy } from './streak-risk-copy';
import type { NotificationSender } from './notification-sender';
import type { NotificationsStore } from './notifications-store';

export interface StreakRiskNotifierDeps {
  readonly store: NotificationsStore;
  readonly sender: NotificationSender;
  readonly now: () => Date;
  readonly windowHours: number;
}

// The one entry point the streak-risk-notification scheduler (server.ts)
// calls on a fixed cadence (STREAK_RISK_NOTIFICATION_INTERVAL_SECONDS) —
// same testable-core/untested-runtime-shell split as sweep.ts/
// streak-expiry.ts. Claims first (an atomic Postgres statement — see
// claim_streak_risk_notifications() — so an overlapping tick can never
// double-claim), then looks up send targets, then dispatches. Each send is
// wrapped so one failed delivery never aborts the batch — same fire-and-
// forget posture as markDeviceTrust's follow-up writes.
export const runStreakRiskNotifications = async (deps: StreakRiskNotifierDeps): Promise<void> => {
  const claimedUserIds = await deps.store.claimStreakRiskUsers(
    deps.now().toISOString(),
    deps.windowHours,
  );
  if (claimedUserIds.length === 0) {
    return;
  }

  const targets = await deps.store.getNotificationTargets(claimedUserIds);

  await Promise.all(
    targets.map(async (target) => {
      const copy = getStreakRiskCopy(target.locale);
      try {
        await deps.sender.send({
          platform: target.platform,
          token: target.token,
          title: copy.title,
          body: copy.body,
        });
      } catch {
        // Fail-open — see header comment.
      }
    }),
  );
};
