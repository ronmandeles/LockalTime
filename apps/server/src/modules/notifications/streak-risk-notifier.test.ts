import { runStreakRiskNotifications } from './streak-risk-notifier';
import type { NotificationsStore, NotificationTarget } from './notifications-store';
import type {
  NotificationSender,
  PushNotificationRequest,
  PushSendResult,
} from './notification-sender';

const NOW = new Date('2026-08-01T12:00:00.000Z');

const buildFakeStore = (
  claimed: ReadonlyArray<string>,
  targets: ReadonlyArray<NotificationTarget>,
): NotificationsStore & { targetLookups: ReadonlyArray<string>[] } => {
  const targetLookups: ReadonlyArray<string>[] = [];
  return {
    targetLookups,
    async claimStreakRiskUsers() {
      return claimed;
    },
    async getNotificationTargets(userIds) {
      targetLookups.push(userIds);
      return targets.filter((target) => userIds.includes(target.userId));
    },
  };
};

const buildFakeSender = (
  behavior?: (request: PushNotificationRequest) => Promise<PushSendResult>,
): NotificationSender & { sent: PushNotificationRequest[] } => {
  const sent: PushNotificationRequest[] = [];
  return {
    sent,
    async send(request) {
      sent.push(request);
      if (behavior) {
        return behavior(request);
      }
      return { status: 'not_configured' };
    },
  };
};

describe('runStreakRiskNotifications', () => {
  it('does nothing when no streak is within the risk window — never looks up targets or sends', async () => {
    const store = buildFakeStore([], []);
    const sender = buildFakeSender();

    await runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 });

    expect(store.targetLookups).toHaveLength(0);
    expect(sender.sent).toHaveLength(0);
  });

  it('sends english copy to a claimed user with no reported locale', async () => {
    const store = buildFakeStore(
      ['user-1'],
      [{ userId: 'user-1', platform: 'android', token: 'token-1', locale: null }],
    );
    const sender = buildFakeSender();

    await runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 });

    expect(sender.sent).toEqual([
      {
        platform: 'android',
        token: 'token-1',
        title: 'Your streak is at risk',
        body: 'Start a session today to keep it going.',
      },
    ]);
  });

  it('sends hebrew copy to a claimed user whose reported locale is he', async () => {
    const store = buildFakeStore(
      ['user-2'],
      [{ userId: 'user-2', platform: 'ios', token: 'token-2', locale: 'he' }],
    );
    const sender = buildFakeSender();

    await runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 });

    expect(sender.sent).toEqual([
      {
        platform: 'ios',
        token: 'token-2',
        title: 'הרצף שלך בסכנה',
        body: 'התחילו מפגש כדי לשמור על הרצף.',
      },
    ]);
  });

  it('sends to every registered device of a claimed user (one row per platform)', async () => {
    const store = buildFakeStore(
      ['user-3'],
      [
        { userId: 'user-3', platform: 'android', token: 'token-a', locale: 'en' },
        { userId: 'user-3', platform: 'ios', token: 'token-b', locale: 'en' },
      ],
    );
    const sender = buildFakeSender();

    await runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 });

    expect(sender.sent).toHaveLength(2);
    expect(sender.sent.map((request) => request.token).sort()).toEqual(['token-a', 'token-b']);
  });

  it('claims a user with no registered device token without attempting any send', async () => {
    const store = buildFakeStore(['user-4'], []);
    const sender = buildFakeSender();

    await runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 });

    expect(store.targetLookups).toEqual([['user-4']]);
    expect(sender.sent).toHaveLength(0);
  });

  it('a failed send for one target never prevents sends to the others', async () => {
    const store = buildFakeStore(
      ['user-5', 'user-6'],
      [
        { userId: 'user-5', platform: 'android', token: 'token-fails', locale: 'en' },
        { userId: 'user-6', platform: 'android', token: 'token-succeeds', locale: 'en' },
      ],
    );
    const sender = buildFakeSender(async (request) => {
      if (request.token === 'token-fails') {
        throw new Error('provider unreachable');
      }
      return { status: 'not_configured' };
    });

    await expect(
      runStreakRiskNotifications({ store, sender, now: () => NOW, windowHours: 6 }),
    ).resolves.toBeUndefined();

    expect(sender.sent.map((request) => request.token).sort()).toEqual([
      'token-fails',
      'token-succeeds',
    ]);
  });
});
