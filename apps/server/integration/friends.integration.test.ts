/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';

// Real username search -> send -> accept/decline -> leaderboard against the
// LOCAL Supabase stack (Phase 6.5). pgTAP (phase6_5_social_test.sql) already
// proves send_friend_request()/respond_to_friend_request()'s own SQL
// semantics in isolation, calling them directly, never through Node -- this
// suite is what proves the whole Node + real-DB path: username search
// returning correct relationship state, the leaderboard's totalPoints/
// hadSessionToday aggregate, and unfriending via a real per-user-scoped
// client exactly the way the mobile app does it (a direct RLS delete, no
// Node endpoint).
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

// emailPrefix becomes the auto-generated username's base (the signup
// trigger falls back to the email local-part as display_name, then
// strips it to alphanumerics for username) — a distinctive, run-unique
// prefix here doubles as a reliable ILIKE search term below.
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

// The only legitimate way to give a user real user_stats/user_streaks
// data (apply_session_stats() creates both lazily, SECURITY DEFINER) —
// same helper shape as notifications.integration.test.ts.
const createUserWithCompletedSession = async (
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

// Unfriending is a direct client-side RLS delete, never a Node endpoint
// (Phase 6.5 plan) — this mirrors the real mobile write path exactly.
const unfriend = async (
  user: { userId: string; token: string },
  friendId: string,
): Promise<void> => {
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: `Bearer ${user.token}` } },
  });
  const { error } = await userClient
    .from('friendships')
    .delete()
    .or(
      `and(user_id_a.eq.${user.userId},user_id_b.eq.${friendId}),and(user_id_a.eq.${friendId},user_id_b.eq.${user.userId})`,
    );
  if (error !== null) {
    throw new Error(`failed to unfriend: ${error.message}`);
  }
};

describe('friends integration (local Supabase)', () => {
  it('search finds a user by username and reports the correct relationship at each stage, ending in a real leaderboard entry', async () => {
    const alice = await createTestUserAndToken('friendsearchalice');
    const bob = await createTestUserAndToken('friendsearchbob');

    // The ILIKE search can also match other runs' leftover fixture users
    // sharing this prefix (the local stack isn't reset between test runs)
    // — assertions below find bob's own result by id rather than assuming
    // he's the only or the first match.
    const beforeRequest = await request(app)
      .get('/friends/search?q=friendsearchbob')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(beforeRequest.status).toBe(200);
    expect(beforeRequest.body.results).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: bob.userId, relationship: 'none' })]),
    );

    const sendResponse = await request(app)
      .post('/friends/requests')
      .set('Authorization', `Bearer ${alice.token}`)
      .send({ recipientId: bob.userId });
    expect(sendResponse.status).toBe(200);
    expect(sendResponse.body).toEqual({ status: 'requested' });

    const afterRequestForAlice = await request(app)
      .get('/friends/search?q=friendsearchbob')
      .set('Authorization', `Bearer ${alice.token}`);
    const bobResult = (afterRequestForAlice.body.results as Array<{ id: string }>).find(
      (result) => result.id === bob.userId,
    );
    expect(bobResult).toEqual(
      expect.objectContaining({ id: bob.userId, relationship: 'requested' }),
    );

    const bobRequests = await request(app)
      .get('/friends/requests')
      .set('Authorization', `Bearer ${bob.token}`);
    expect(bobRequests.status).toBe(200);
    expect(bobRequests.body.incoming).toEqual([expect.objectContaining({ userId: alice.userId })]);
    const requestId = bobRequests.body.incoming[0].id as string;

    const respondResponse = await request(app)
      .post(`/friends/requests/${requestId}/respond`)
      .set('Authorization', `Bearer ${bob.token}`)
      .send({ accept: true });
    expect(respondResponse.status).toBe(200);
    expect(respondResponse.body).toEqual({ status: 'accepted' });

    const aliceLeaderboard = await request(app)
      .get('/friends')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(aliceLeaderboard.status).toBe(200);
    expect(aliceLeaderboard.body.leaderboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: alice.userId, isSelf: true }),
        expect.objectContaining({ id: bob.userId, isSelf: false }),
      ]),
    );

    await unfriend(alice, bob.userId);
    const aliceLeaderboardAfterUnfriend = await request(app)
      .get('/friends')
      .set('Authorization', `Bearer ${alice.token}`);
    expect(aliceLeaderboardAfterUnfriend.body.leaderboard).toEqual([
      expect.objectContaining({ id: alice.userId, isSelf: true }),
    ]);
  });

  it('a mutual double-request (both users request each other before either responds) auto-resolves to friends', async () => {
    const carol = await createTestUserAndToken('friendmutualcarol');
    const dave = await createTestUserAndToken('friendmutualdave');

    await request(app)
      .post('/friends/requests')
      .set('Authorization', `Bearer ${carol.token}`)
      .send({ recipientId: dave.userId })
      .expect(200);

    const reverseResponse = await request(app)
      .post('/friends/requests')
      .set('Authorization', `Bearer ${dave.token}`)
      .send({ recipientId: carol.userId });
    expect(reverseResponse.body).toEqual({ status: 'friends' });

    const carolRequests = await request(app)
      .get('/friends/requests')
      .set('Authorization', `Bearer ${carol.token}`);
    expect(carolRequests.body.incoming).toEqual([]);
    expect(carolRequests.body.outgoing).toEqual([]);
  });

  it('declining a request removes it without creating a friendship', async () => {
    const erin = await createTestUserAndToken('frienddeclineerin');
    const frank = await createTestUserAndToken('frienddeclinefrank');

    await request(app)
      .post('/friends/requests')
      .set('Authorization', `Bearer ${erin.token}`)
      .send({ recipientId: frank.userId })
      .expect(200);

    const frankRequests = await request(app)
      .get('/friends/requests')
      .set('Authorization', `Bearer ${frank.token}`);
    const requestId = frankRequests.body.incoming[0].id as string;

    const declineResponse = await request(app)
      .post(`/friends/requests/${requestId}/respond`)
      .set('Authorization', `Bearer ${frank.token}`)
      .send({ accept: false });
    expect(declineResponse.body).toEqual({ status: 'declined' });

    const erinLeaderboard = await request(app)
      .get('/friends')
      .set('Authorization', `Bearer ${erin.token}`);
    expect(erinLeaderboard.body.leaderboard).toEqual([
      expect.objectContaining({ id: erin.userId, isSelf: true }),
    ]);
  });

  it("a friend's real completed session shows up as hadSessionToday: true and their real totalPoints in the caller's leaderboard", async () => {
    const active = await createUserWithCompletedSession('friendactivegrace');
    const passive = await createTestUserAndToken('friendpassiveheidi');

    await request(app)
      .post('/friends/requests')
      .set('Authorization', `Bearer ${passive.token}`)
      .send({ recipientId: active.userId })
      .expect(200);
    const activeRequests = await request(app)
      .get('/friends/requests')
      .set('Authorization', `Bearer ${active.token}`);
    const requestId = activeRequests.body.incoming[0].id as string;
    await request(app)
      .post(`/friends/requests/${requestId}/respond`)
      .set('Authorization', `Bearer ${active.token}`)
      .send({ accept: true })
      .expect(200);

    const { data: stats } = await adminClient
      .from('user_stats')
      .select('total_points')
      .eq('user_id', active.userId)
      .single();

    const leaderboard = await request(app)
      .get('/friends')
      .set('Authorization', `Bearer ${passive.token}`);
    expect(leaderboard.body.leaderboard).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: active.userId,
          hadSessionToday: true,
          totalPoints: stats?.total_points,
        }),
      ]),
    );
  });
});
