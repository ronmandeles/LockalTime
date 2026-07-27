/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';

// Real create -> join -> leave against the LOCAL Supabase stack: exercises
// the actual join_session() Postgres function (concurrency safety), the
// RLS read policies, and the full HTTP stack together — none of which the
// mocked-store unit tests can prove on their own.
//
// NOT part of `npm test` (jest.config.js ignores integration/): run via
// `npm run test:integration` with `npx supabase start` up. CI runs it in
// the db job, after pgTAP. Fails fast with a clear message when the stack
// is unreachable — never skips silently (testing-standards skill).
//
// Local Supabase CLI's standard demo keys (same values documented in
// apps/server/.env.example and apps/mobile/src/config/supabase-config.ts)
// — public by design, safe to commit.
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

// Creates a real, confirmed auth user and returns a real access token for
// them — signed by the actual local GoTrue, not hand-minted, so
// require-auth's verification runs against a genuine token end to end.
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

describe('sessions integration (local Supabase)', () => {
  it('create -> join -> leave produces the correct presence-interval row', async () => {
    const host = await createTestUserAndToken('host');
    const participant = await createTestUserAndToken('participant');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'fixed', planned_duration_minutes: 30 });
    expect(createResponse.status).toBe(201);
    const sessionId = createResponse.body.id as string;
    const qrToken = createResponse.body.qrToken as string;

    const joinResponse = await request(app)
      .post('/sessions/join')
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ token: qrToken });
    expect(joinResponse.status).toBe(201);
    expect(joinResponse.body).toEqual({ sessionId });

    // Rejoin is idempotent, not an error.
    const rejoinResponse = await request(app)
      .post('/sessions/join')
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ token: qrToken });
    expect(rejoinResponse.status).toBe(200);

    const leaveResponse = await request(app)
      .post(`/sessions/${sessionId}/leave`)
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ reason: 'emergency_exit' });
    expect(leaveResponse.status).toBe(200);

    const { data: intervals, error } = await adminClient
      .from('session_presence_intervals')
      .select('user_id, left_at, disconnect_reason')
      .eq('session_id', sessionId);
    expect(error).toBeNull();
    // 2 rows: the host's own open interval (Phase 4 — created immediately
    // at session creation) + the participant's now-closed one.
    expect(intervals).toHaveLength(2);
    const participantInterval = intervals?.find((row) => row.user_id === participant.userId);
    expect(participantInterval).toMatchObject({
      disconnect_reason: 'emergency_exit',
    });
    expect(participantInterval?.left_at).not.toBeNull();

    const hostInterval = intervals?.find((row) => row.user_id === host.userId);
    expect(hostInterval).toMatchObject({ left_at: null, disconnect_reason: null });
  });

  it('records a monitor-mode device attestation row when the create request includes one', async () => {
    const host = await createTestUserAndToken('attestation-host');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 15,
        attestation: { platform: 'android', token: 'device-attestation-token' },
      });
    expect(createResponse.status).toBe(201);
    const sessionId = createResponse.body.id as string;

    const { data: attestations, error } = await adminClient
      .from('device_attestations')
      .select('user_id, platform, action, verdict, raw_response')
      .eq('session_id', sessionId);
    expect(error).toBeNull();
    expect(attestations).toEqual([
      {
        user_id: host.userId,
        platform: 'android',
        action: 'create',
        verdict: 'not_configured',
        raw_response: { platform: 'android', reason: 'no attestation credentials configured' },
      },
    ]);
  });

  it('RLS: a session participant can read it, a non-participant cannot', async () => {
    const host = await createTestUserAndToken('rls-host');
    const outsider = await createTestUserAndToken('rls-outsider');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 15 });
    const sessionId = createResponse.body.id as string;

    const hostClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${host.token}` } },
    });
    const outsiderClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${outsider.token}` } },
    });

    const hostRead = await hostClient.from('sessions').select('id').eq('id', sessionId);
    expect(hostRead.data).toHaveLength(1);

    const outsiderRead = await outsiderClient.from('sessions').select('id').eq('id', sessionId);
    expect(outsiderRead.data).toHaveLength(0);
  });

  it('a concurrent double-join at capacity admits exactly one caller', async () => {
    const host = await createTestUserAndToken('capacity-host');
    const a = await createTestUserAndToken('capacity-a');
    const b = await createTestUserAndToken('capacity-b');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'fixed', planned_duration_minutes: 30 });
    const sessionId = createResponse.body.id as string;
    const qrToken = createResponse.body.qrToken as string;

    // Exercises join_session() directly with max_participants=2 — the host
    // already occupies 1 slot from creation (Phase 4: the host gets their
    // own open presence interval immediately), leaving exactly 1 open slot
    // for the two concurrent callers below. Proves the DB-level row lock
    // serializes two truly concurrent callers, independent of the app's
    // SESSION_MAX_PARTICIPANTS constant.
    const [resultA, resultB] = await Promise.all([
      adminClient.rpc('join_session', {
        p_session_id: sessionId,
        p_user_id: a.userId,
        p_token: qrToken,
        p_max_participants: 2,
      }),
      adminClient.rpc('join_session', {
        p_session_id: sessionId,
        p_user_id: b.userId,
        p_token: qrToken,
        p_max_participants: 2,
      }),
    ]);

    const outcomes = [resultA.data, resultB.data].sort();
    expect(outcomes).toEqual(['at_capacity', 'joined']);
  });

  it('create -> join -> end produces session_participants + rewards_history rows, readable only by their own user', async () => {
    const host = await createTestUserAndToken('end-host');
    const participant = await createTestUserAndToken('end-participant');

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
    expect(endResponse.body.endedAt).toEqual(expect.any(String));

    const { data: sessionRow } = await adminClient
      .from('sessions')
      .select('status, end_reason, ended_by')
      .eq('id', sessionId)
      .single();
    expect(sessionRow).toMatchObject({
      status: 'completed',
      end_reason: 'host_ended',
      ended_by: host.userId,
    });

    const { data: participants } = await adminClient
      .from('session_participants')
      .select('user_id, exit_reason, is_host, points_earned')
      .eq('session_id', sessionId);
    expect(participants).toHaveLength(2);
    expect(participants).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ user_id: host.userId, exit_reason: 'completed', is_host: true }),
        expect.objectContaining({
          user_id: participant.userId,
          exit_reason: 'completed',
          is_host: false,
        }),
      ]),
    );

    // Ending closes every open interval -- a second /end call must find
    // nothing left to do (already 'completed', not 'active').
    const secondEnd = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(secondEnd.status).toBe(409);

    // RLS: each user reads only their own rewards_history rows.
    const hostClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${host.token}` } },
    });
    const hostRewards = await hostClient
      .from('rewards_history')
      .select('user_id, bonus_type')
      .eq('session_id', sessionId);
    expect(hostRewards.data?.every((row) => row.user_id === host.userId)).toBe(true);
    expect(hostRewards.data?.some((row) => row.bonus_type === 'base')).toBe(true);
  });
});
