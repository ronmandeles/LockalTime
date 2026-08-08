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

    // Emergency exit finalizes inline (Phase 4 task 5) -- base points only,
    // both bonuses forfeited, written immediately rather than waiting for
    // the session to end.
    const { data: participantRows } = await adminClient
      .from('session_participants')
      .select('user_id, exit_reason, group_bonus_earned, completion_bonus_earned')
      .eq('session_id', sessionId);
    expect(participantRows).toEqual([
      {
        user_id: participant.userId,
        exit_reason: 'emergency_exit',
        group_bonus_earned: false,
        completion_bonus_earned: false,
      },
    ]);

    const { data: rewardRows } = await adminClient
      .from('rewards_history')
      .select('user_id, bonus_type')
      .eq('session_id', sessionId);
    expect(rewardRows).toEqual([{ user_id: participant.userId, bonus_type: 'base' }]);
  });

// Phase 9 task 1. The unit tests all run against a fake SessionsStore, so
  // a mistyped column name would sail straight through them and only fail
  // in production as `column sessions.blocked_category does not exist`.
  // This is the only test that proves the arrays survive the real
  // PostgREST round trip, in both directions.
  it('round-trips a host-selected blocklist through the real sessions table', async () => {
    const host = await createTestUserAndToken('blocklist-host');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        type: 'dynamic_qr',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        blocked_categories: ['social', 'news'],
        blocked_packages: ['com.instagram.android', 'com.zhiliaoapp.musically'],
      });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.blockedCategories).toEqual(['social', 'news']);
    expect(createResponse.body.blockedPackages).toEqual([
      'com.instagram.android',
      'com.zhiliaoapp.musically',
    ]);

    const sessionId = createResponse.body.id as string;
    const { data: row, error } = await adminClient
      .from('sessions')
      .select('blocked_categories, blocked_packages')
      .eq('id', sessionId)
      .single();
    expect(error).toBeNull();
    expect(row).toEqual({
      blocked_categories: ['social', 'news'],
      blocked_packages: ['com.instagram.android', 'com.zhiliaoapp.musically'],
    });

    // ...and back out again through /preview, which is how a member's
    // device learns what the session blocks before joining it.
    const previewResponse = await request(app)
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ token: createResponse.body.qrToken as string });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body.blockedCategories).toEqual(['social', 'news']);
    expect(previewResponse.body.blockedPackages).toEqual([
      'com.instagram.android',
      'com.zhiliaoapp.musically',
    ]);
  });

  it('defaults a session created without a blocklist to the three historical categories', async () => {
    const host = await createTestUserAndToken('blocklist-default-host');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(createResponse.status).toBe(201);
    expect(createResponse.body.blockedCategories).toEqual(['social', 'games', 'entertainment']);
    expect(createResponse.body.blockedPackages).toEqual([]);
  });

  it('rejects a static_qr blocklist outside its venue approved set, against a real venue row', async () => {
    const host = await createTestUserAndToken('venue-blocklist-host');

    // Inserted directly rather than via POST /venues: that route needs the
    // verified-host flag, and nothing here is testing venue creation.
    const { data: venue, error: venueError } = await adminClient
      .from('venues')
      .insert({
        owner_id: host.userId,
        name: 'Blocklist Cafe',
        qr_token: `blocklist-venue-${Date.now()}`,
        approved_blocked_categories: ['social'],
        approved_blocked_packages: [],
      })
      .select('id')
      .single();
    expect(venueError).toBeNull();
    const venueId = (venue as { id: string }).id;

    const rejected = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        type: 'static_qr',
        duration_mode: 'open_ended',
        venue_id: venueId,
        blocked_categories: ['social', 'maps'],
      });

    expect(rejected.status).toBe(403);
    expect(rejected.body.error.code).toBe('blocklist_not_venue_approved');
    expect(rejected.body.error.message).toContain('maps');

    const accepted = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({
        type: 'static_qr',
        duration_mode: 'open_ended',
        venue_id: venueId,
        blocked_categories: ['social'],
      });

    expect(accepted.status).toBe(201);
    expect(accepted.body.blockedCategories).toEqual(['social']);
  });

  it('POST /:id/blocker-ready sets blocker_ready_at once and is idempotent on a second call', async () => {
    const host = await createTestUserAndToken('blocker-ready-host');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });
    const sessionId = createResponse.body.id as string;

    const first = await request(app)
      .post(`/sessions/${sessionId}/blocker-ready`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(first.status).toBe(200);

    const { data: afterFirst } = await adminClient
      .from('session_presence_intervals')
      .select('blocker_ready_at')
      .eq('session_id', sessionId)
      .single();
    expect(afterFirst?.blocker_ready_at).not.toBeNull();
    const firstReadyAt = afterFirst?.blocker_ready_at as string;

    const second = await request(app)
      .post(`/sessions/${sessionId}/blocker-ready`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(second.status).toBe(200);

    const { data: afterSecond } = await adminClient
      .from('session_presence_intervals')
      .select('blocker_ready_at')
      .eq('session_id', sessionId)
      .single();
    // A second call never overwrites the first legitimate timestamp.
    expect(afterSecond?.blocker_ready_at).toBe(firstReadyAt);
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

  it('create -> join -> disconnect -> rejoin re-opens a presence interval without a token', async () => {
    const host = await createTestUserAndToken('rejoin-host');
    const participant = await createTestUserAndToken('rejoin-participant');
    const stranger = await createTestUserAndToken('rejoin-stranger');

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

    // A user with no prior presence interval for this session is rejected —
    // rejoin authorizes on history, never lets a stranger in without a token.
    const strangerRejoin = await request(app)
      .post(`/sessions/${sessionId}/rejoin`)
      .set('Authorization', `Bearer ${stranger.token}`);
    expect(strangerRejoin.status).toBe(403);
    expect(strangerRejoin.body.error.code).toBe('not_a_prior_participant');

    // involuntary_disconnect never finalizes — the participant may still
    // reconnect, exactly the gap rejoin exists to close.
    await request(app)
      .post(`/sessions/${sessionId}/leave`)
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ reason: 'involuntary_disconnect' })
      .expect(200);

    const { data: afterLeave } = await adminClient
      .from('session_presence_intervals')
      .select('left_at')
      .eq('session_id', sessionId)
      .eq('user_id', participant.userId)
      .single();
    expect(afterLeave?.left_at).not.toBeNull();

    // No token in the body at all — the whole point of this endpoint.
    const rejoinResponse = await request(app)
      .post(`/sessions/${sessionId}/rejoin`)
      .set('Authorization', `Bearer ${participant.token}`);
    expect(rejoinResponse.status).toBe(201);
    expect(rejoinResponse.body).toEqual({ sessionId });

    const idempotentRejoin = await request(app)
      .post(`/sessions/${sessionId}/rejoin`)
      .set('Authorization', `Bearer ${participant.token}`);
    expect(idempotentRejoin.status).toBe(200);

    const { data: intervals } = await adminClient
      .from('session_presence_intervals')
      .select('left_at')
      .eq('session_id', sessionId)
      .eq('user_id', participant.userId);
    // The original closed interval plus the new open one from rejoin — the
    // idempotent second call above must not have opened a third.
    expect(intervals).toHaveLength(2);
    expect(intervals?.filter((row) => row.left_at === null)).toHaveLength(1);

    // Ending now proves the Phase 4 DoD line end to end: the disconnect gap
    // disqualifies the Completion Bonus (the participant has 2 intervals,
    // not the required 1 — computeCompletionBonusEligibility's own unit
    // tests own the underlying rule), but base points are still credited
    // for both presence spans (end-session.ts includes every interval, not
    // just the most recent one).
    const endResponse = await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(endResponse.status).toBe(200);

    const { data: participantRow } = await adminClient
      .from('session_participants')
      .select('exit_reason, completion_bonus_earned')
      .eq('session_id', sessionId)
      .eq('user_id', participant.userId)
      .single();
    expect(participantRow).toEqual({ exit_reason: 'completed', completion_bonus_earned: false });

    const { data: rewardsRows } = await adminClient
      .from('rewards_history')
      .select('bonus_type')
      .eq('session_id', sessionId)
      .eq('user_id', participant.userId);
    // Always a base row, even though the real elapsed time in this test is
    // well under a minute (rounds to 0 base points) — the row's PRESENCE is
    // what proves points were computed and credited, not zeroed out for
    // having disconnected.
    expect(rewardsRows).toEqual([{ bonus_type: 'base' }]);
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
