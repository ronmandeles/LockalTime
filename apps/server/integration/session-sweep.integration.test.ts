/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';
import { createSupabaseSessionRealtimePort } from '../src/modules/sessions/session-realtime-port';
import { createSupabaseSessionsStore } from '../src/modules/sessions/sessions-store';
import { runSweep } from '../src/modules/sessions/sweep';

// Real presence/host-migration proof against the LOCAL Supabase Realtime
// service — sweep.ts's own unit tests (sweep.test.ts) cover every branch
// of the decision logic with a fake realtime port; this file is the one
// place session-realtime-port.ts's actual supabase-js wiring (subscribing,
// reading presenceState(), broadcasting) gets exercised for real, the same
// role apps/mobile/src/services/session-channel.integration.test.ts plays
// on the client side. Runs slower than the rest of the suite (real
// wall-clock waits past the 20s host-migration debounce) — that's the
// nature of proving a real-time debounce actually works, not something to
// mock away.
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const TEST_PASSWORD = 'Integration-Test-Password-123!';

jest.setTimeout(60000);

let env: Env;
let app: Express;
let adminClient: SupabaseClient;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

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

describe('session sweep integration (local Supabase Realtime)', () => {
  it('migrates the host to the present participant once real presence absence exceeds the debounce window', async () => {
    const host = await createTestUserAndToken('sweep-host');
    const participant = await createTestUserAndToken('sweep-participant');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'open_ended' });
    expect(createResponse.status).toBe(201);
    const sessionId = createResponse.body.id as string;
    const qrToken = createResponse.body.qrToken as string;

    await request(app)
      .post('/sessions/join')
      .set('Authorization', `Bearer ${participant.token}`)
      .send({ token: qrToken })
      .expect(201);

    const store = createSupabaseSessionsStore(adminClient);
    const realtime = createSupabaseSessionRealtimePort(adminClient);

    // Subscribe the server's own presence tracker first (mirrors
    // sweep.ts's runSweep() calling track() every tick) and give the
    // websocket subscription time to actually establish.
    realtime.track(sessionId);
    await sleep(1500);

    // Only the participant's real client ever connects/tracks presence —
    // the host never does, simulating a dropped host connection. Uses the
    // same channel name and track() shape as
    // apps/mobile/src/services/session-channel.ts.
    const participantClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${participant.token}` } },
    });
    const participantChannel = participantClient.channel(`session:${sessionId}`);
    await new Promise<void>((resolve, reject) => {
      participantChannel.subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          participantChannel
            .track({
              user_id: participant.userId,
              is_host: false,
              joined_at: new Date().toISOString(),
            })
            .then(() => resolve())
            .catch(reject);
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          reject(new Error(`participant channel failed to subscribe: ${status}`));
        }
      });
    });

    // Let the presence sync actually propagate back to the server's
    // listener before asserting on it.
    await sleep(1500);
    const seenAfterTrack = realtime.lastSeenAt(sessionId);
    expect(seenAfterTrack.has(participant.userId)).toBe(true);
    expect(seenAfterTrack.has(host.userId)).toBe(false); // host never tracked at all

    // The host's absence reference falls back to the session's started_at
    // (set at creation, a few seconds ago by now) — wait past the 20s
    // debounce from there, then run one real sweep pass.
    await sleep(18000);
    await runSweep({ store, realtime, now: () => new Date() });

    const { data: sessionRow } = await adminClient
      .from('sessions')
      .select('host_id')
      .eq('id', sessionId)
      .single();
    expect(sessionRow?.host_id).toBe(participant.userId);

    const { data: assignments } = await adminClient
      .from('session_host_assignments')
      .select('user_id, reason, unassigned_at')
      .eq('session_id', sessionId)
      .order('assigned_at', { ascending: true });
    expect(assignments).toEqual([
      { user_id: host.userId, reason: 'initial_host', unassigned_at: expect.any(String) },
      { user_id: participant.userId, reason: 'migration', unassigned_at: null },
    ]);

    await participantClient.removeChannel(participantChannel);
    realtime.untrack(sessionId);
  });
});
