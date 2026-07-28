/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';
import type {
  NotificationSender,
  PushNotificationRequest,
} from '../src/modules/notifications/notification-sender';
import { createSupabaseNotificationsStore } from '../src/modules/notifications/notifications-store';
import { runStreakRiskNotifications } from '../src/modules/notifications/streak-risk-notifier';

// Real streak-risk claim -> target lookup -> dispatch against the LOCAL
// Supabase stack (Phase 5.5). Proves the Node-level composition
// (NotificationsStore's two queries + streak-risk-notifier.ts's dispatch)
// works end-to-end. pgTAP (phase5_5_push_notifications_test.sql) already
// proves the claim function's own SQL semantics in isolation, calling it
// directly, never through Node -- this suite is what proves Node actually
// wires that function to a real device token and a real send attempt.
//
// NOT part of `npm test` (jest.config.js ignores integration/): run via
// `npm run test:integration` with `npx supabase start` up.
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'Integration-Test-Password-123!';

jest.setTimeout(30000);

let env: Env;
let app: Express;
let adminClient: SupabaseClient;

beforeAll(async () => {
  try {
    const health = await fetch(`${SUPABASE_URL}/auth/v1/health`, {
      headers: { apikey: SUPABASE_ANON_KEY },
    });
    if (!health.ok) {
      throw new Error(`GoTrue health check responded ${health.status}`);
    }
  } catch (thrown) {
    const reason = thrown instanceof Error ? thrown.message : String(thrown);
    throw new Error(
      `local Supabase stack is not running (${reason}) — start it with \`npx supabase start\``,
    );
  }

  env = loadEnv({
    SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY,
    QR_SIGNING_SECRET: 'integration-test-qr-signing-secret-32-characters',
  });
  app = createApp(env);
  adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
});

const createTestUserAndToken = async (
  emailPrefix: string,
): Promise<{ userId: string; token: string }> => {
  const email = `${emailPrefix}-${Date.now()}-${Math.random()
    .toString(36)
    .slice(2)}@integration.test`;
  const created = await adminClient.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
  });
  if (created.error !== null || created.data.user === null) {
    throw new Error(`failed to create test user: ${created.error?.message}`);
  }

  const anonClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const signedIn = await anonClient.auth.signInWithPassword({ email, password: TEST_PASSWORD });
  if (signedIn.error !== null || signedIn.data.session === null) {
    throw new Error(`failed to sign in test user: ${signedIn.error?.message}`);
  }

  return { userId: created.data.user.id, token: signedIn.data.session.access_token };
};

// user_streaks is only ever created lazily by apply_session_stats()
// (SECURITY DEFINER) — service_role's own grant on the table is select +
// update only, no insert (Phase 5 migration, by design: a Node-side insert
// would bypass the streak math entirely). A real create -> join -> end is
// the only legitimate way to seed a fixture row, after which the test uses
// service_role's UPDATE grant to move streak_grace_expires_at to a
// controlled point in time instead of waiting out STREAK_GRACE_HOURS.
const createUserWithStreak = async (
  emailPrefix: string,
): Promise<{ userId: string; token: string }> => {
  const user = await createTestUserAndToken(emailPrefix);
  const createResponse = await request(app)
    .post('/sessions')
    .set('Authorization', `Bearer ${user.token}`)
    .send({ type: 'dynamic_qr', duration_mode: 'open_ended' });
  const sessionId = createResponse.body.id as string;
  await request(app)
    .post(`/sessions/${sessionId}/end`)
    .set('Authorization', `Bearer ${user.token}`);
  return user;
};

const setStreakGraceExpiry = async (userId: string, expiresAt: Date): Promise<void> => {
  const { error } = await adminClient
    .from('user_streaks')
    .update({ streak_grace_expires_at: expiresAt.toISOString() })
    .eq('user_id', userId);
  if (error !== null) {
    throw new Error(`failed to set streak_grace_expires_at: ${error.message}`);
  }
};

// Registration is always a direct authenticated client write (task 1) —
// service_role has no insert grant on device_tokens by design. Mirrors the
// real mobile write path exactly: a client bound to the user's own session.
const registerDeviceToken = async (
  user: { userId: string; token: string },
  platform: 'android' | 'ios',
  deviceToken: string,
): Promise<void> => {
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${user.token}` } },
  });
  const { error } = await userClient
    .from('device_tokens')
    .insert({ user_id: user.userId, platform, token: deviceToken });
  if (error !== null) {
    throw new Error(`failed to register device token: ${error.message}`);
  }
};

const buildRecordingSender = (): NotificationSender & { sent: PushNotificationRequest[] } => {
  const sent: PushNotificationRequest[] = [];
  return {
    sent,
    async send(sendRequest) {
      sent.push(sendRequest);
      return { status: 'recorded' };
    },
  };
};

describe('streak-risk notification dispatch integration (local Supabase)', () => {
  it('sends a real dispatch to a streak within the risk window, then does not re-notify on an immediate second tick', async () => {
    const user = await createUserWithStreak('risk-within-window');
    await setStreakGraceExpiry(user.userId, new Date(Date.now() + 5 * 60 * 60 * 1000));
    await registerDeviceToken(user, 'android', `token-${user.userId}`);

    const sender = buildRecordingSender();
    const store = createSupabaseNotificationsStore(adminClient);

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });

    const firstTickSends = sender.sent.filter(
      (request) => request.token === `token-${user.userId}`,
    );
    expect(firstTickSends).toEqual([
      {
        platform: 'android',
        token: `token-${user.userId}`,
        title: expect.any(String),
        body: expect.any(String),
      },
    ]);

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });

    const afterSecondTick = sender.sent.filter(
      (request) => request.token === `token-${user.userId}`,
    );
    expect(afterSecondTick).toHaveLength(1);
  });

  it('never claims or sends to a streak whose grace deadline is outside the risk window', async () => {
    const user = await createUserWithStreak('risk-outside-window');
    await setStreakGraceExpiry(user.userId, new Date(Date.now() + 20 * 60 * 60 * 1000));
    await registerDeviceToken(user, 'ios', `token-${user.userId}`);

    const sender = buildRecordingSender();
    const store = createSupabaseNotificationsStore(adminClient);

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });

    expect(sender.sent.some((request) => request.token === `token-${user.userId}`)).toBe(false);
  });

  it('claims a streak with no registered device token (consuming its window) without any send attempt', async () => {
    const user = await createUserWithStreak('risk-no-device');
    await setStreakGraceExpiry(user.userId, new Date(Date.now() + 5 * 60 * 60 * 1000));

    const sender = buildRecordingSender();
    const store = createSupabaseNotificationsStore(adminClient);

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });

    expect(sender.sent).toHaveLength(0);
    const { data } = await adminClient
      .from('user_streaks')
      .select('risk_notification_sent_for, streak_grace_expires_at')
      .eq('user_id', user.userId)
      .single();
    expect(data?.risk_notification_sent_for).toBe(data?.streak_grace_expires_at);
  });

  it('a fresh grace deadline is eligible again even after the previous one was already notified', async () => {
    const user = await createUserWithStreak('risk-fresh-deadline');
    await setStreakGraceExpiry(user.userId, new Date(Date.now() + 5 * 60 * 60 * 1000));
    await registerDeviceToken(user, 'android', `token-${user.userId}`);

    const sender = buildRecordingSender();
    const store = createSupabaseNotificationsStore(adminClient);

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });
    expect(sender.sent.filter((request) => request.token === `token-${user.userId}`)).toHaveLength(
      1,
    );

    // Simulates a fresh session pushing the deadline forward — still
    // within the window, but a genuinely new, distinct deadline.
    await setStreakGraceExpiry(user.userId, new Date(Date.now() + 4 * 60 * 60 * 1000));

    await runStreakRiskNotifications({ store, sender, now: () => new Date(), windowHours: 6 });
    expect(sender.sent.filter((request) => request.token === `token-${user.userId}`)).toHaveLength(
      2,
    );
  });
});
