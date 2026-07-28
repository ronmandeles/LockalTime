/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';

// Real create -> join -> end / emergency-exit against the LOCAL Supabase
// stack, proving apply_session_stats() actually gets called from both
// Node finalization paths and that user_stats/user_stats_daily/
// user_streaks land correctly through the real HTTP + Postgres function
// stack — none of which the mocked-store unit tests (end-session.test.ts,
// finalize-emergency-exit.test.ts) can prove on their own, and none of
// which the pgTAP suite (which calls apply_session_stats() directly, not
// through Node) proves either. Phase 5 task 4.
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

// The core Phase 5 DoD invariant: user_stats.total_points must exactly
// equal the sum of that user's rewards_history rows, proven against the
// real DB rather than only inside the pgTAP suite (which calls the
// Postgres function directly, not through Node's two HTTP-triggered call
// sites).
const assertTotalPointsInvariant = async (userId: string): Promise<void> => {
  const { data: stats } = await adminClient
    .from('user_stats')
    .select('total_points')
    .eq('user_id', userId)
    .single();
  const { data: rewards } = await adminClient
    .from('rewards_history')
    .select('points')
    .eq('user_id', userId);
  const sum = (rewards ?? []).reduce((total, row) => total + (row.points as number), 0);
  expect(stats?.total_points).toBe(sum);
};

describe('gamification stats integration (local Supabase)', () => {
  it('create -> join -> end accumulates user_stats/user_stats_daily/user_streaks for both participants', async () => {
    const host = await createTestUserAndToken('gami-host');
    const participant = await createTestUserAndToken('gami-participant');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'open_ended' });
    const sessionId = createResponse.body.id as string;
    const qrToken = createResponse.body.qrToken as string;

    await request(app)
      .post('/sessions/join')
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ token: qrToken })
      .expect(201);

    const endResponse = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(endResponse.status).toBe(200);

    for (const userId of [host.userId, participant.userId]) {
      const { data: stats } = await adminClient
        .from('user_stats')
        .select('sessions_completed, sessions_emergency_exit, sessions_disconnected')
        .eq('user_id', userId)
        .single();
      expect(stats).toEqual({
        sessions_completed: 1,
        sessions_emergency_exit: 0,
        sessions_disconnected: 0,
      });

      const { data: streak } = await adminClient
        .from('user_streaks')
        .select('current_streak, longest_streak')
        .eq('user_id', userId)
        .single();
      expect(streak).toEqual({ current_streak: 1, longest_streak: 1 });

      const { data: daily } = await adminClient
        .from('user_stats_daily')
        .select('sessions')
        .eq('user_id', userId);
      expect(daily).toHaveLength(1);
      expect(daily?.[0]?.sessions).toBe(1);

      await assertTotalPointsInvariant(userId);
    }

    // session_participants.stats_applied_at is the exactly-once guard this
    // whole wiring depends on — prove it's actually set, not just that a
    // re-run happens to be harmless.
    const { data: participantRows } = await adminClient
      .from('session_participants')
      .select('stats_applied_at')
      .eq('session_id', sessionId);
    expect(participantRows?.every((row) => row.stats_applied_at !== null)).toBe(true);

    // A second /end is rejected before it can touch anything (proven
    // already in sessions.integration.test.ts) -- confirm stats really are
    // untouched, not just that the HTTP call was rejected.
    await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(409);

    const { data: statsAfterSecondEnd } = await adminClient
      .from('user_stats')
      .select('sessions_completed')
      .eq('user_id', host.userId)
      .single();
    expect(statsAfterSecondEnd?.sessions_completed).toBe(1);
  });

  it('emergency exit accumulates stats immediately (inline finalization path)', async () => {
    const host = await createTestUserAndToken('gami-ee-host');
    const participant = await createTestUserAndToken('gami-ee-participant');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'fixed', planned_duration_minutes: 30 });
    const sessionId = createResponse.body.id as string;
    const qrToken = createResponse.body.qrToken as string;

    await request(app)
      .post('/sessions/join')
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ token: qrToken })
      .expect(201);

    await request(app)
      .post(`/sessions/${sessionId}/leave`)
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ reason: 'emergency_exit' })
      .expect(200);

    const { data: stats } = await adminClient
      .from('user_stats')
      .select('sessions_completed, sessions_emergency_exit')
      .eq('user_id', participant.userId)
      .single();
    expect(stats).toEqual({ sessions_completed: 0, sessions_emergency_exit: 1 });

    const { data: participantRow } = await adminClient
      .from('session_participants')
      .select('stats_applied_at')
      .eq('session_id', sessionId)
      .eq('user_id', participant.userId)
      .single();
    expect(participantRow?.stats_applied_at).not.toBeNull();

    await assertTotalPointsInvariant(participant.userId);
  });
});
