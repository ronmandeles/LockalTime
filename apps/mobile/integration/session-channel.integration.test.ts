/**
 * @jest-environment node
 */
import { randomUUID } from 'crypto';

import { createClient } from '@supabase/supabase-js';

import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../src/config/supabase-config';

// Real Supabase Realtime against the LOCAL stack: proves the two
// primitives session-channel.ts wires actually deliver across two
// independent clients, not just that the right SDK calls were made (the
// mocked-client unit tests already cover that).
//
// NOT part of `npm test` (jest.config.js ignores integration/): run via
// `npm run test:integration` with `npx supabase start` up — this test
// needs the `realtime` service, so the CI db job no longer excludes it
// (.github/workflows/ci.yml). Fails fast with a clear message when the
// stack is unreachable.
//
// Local Supabase CLI's standard demo service-role key — same value
// documented in apps/server/.env.example, public by design. Only used here
// to set up realistic conditions (a server-role write, mirroring what the
// Node API actually does); the app itself never uses this key.
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

jest.setTimeout(30000);

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const waitForSubscribed = (channel: ReturnType<ReturnType<typeof createClient>['channel']>) =>
  new Promise<void>((resolve, reject) => {
    channel.subscribe((status: string, err?: Error) => {
      if (status === 'SUBSCRIBED') {
        resolve();
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
        reject(err ?? new Error(`channel subscribe failed: ${status}`));
      }
    });
  });

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
});

describe('session realtime channel (local Supabase)', () => {
  it('delivers a Broadcast participant_joined pulse from one client to another', async () => {
    const channelName = `session:broadcast-test-${Date.now()}`;
    const clientA = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const clientB = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    try {
      const channelA = clientA.channel(channelName);
      const received = new Promise((resolve) => {
        channelA.on('broadcast', { event: 'participant_joined' }, ({ payload }) => resolve(payload));
      });
      await waitForSubscribed(channelA);

      const channelB = clientB.channel(channelName);
      await waitForSubscribed(channelB);
      await channelB.send({
        type: 'broadcast',
        event: 'participant_joined',
        payload: { userId: 'user-b' },
      });

      await expect(received).resolves.toEqual({ userId: 'user-b' });

      await clientB.removeChannel(channelB);
      await clientA.removeChannel(channelA);
    } finally {
      await clientA.auth.signOut();
      await clientB.auth.signOut();
    }
  });

  it('delivers a Postgres Changes event for a real session_presence_intervals write', async () => {
    const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const email = `realtime-cdc-${Date.now()}@integration.test`;
    const password = 'Integration-Test-Password-123!';
    const created = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error !== null || created.data.user === null) {
      throw new Error(`failed to create test user: ${created.error?.message}`);
    }
    const hostId = created.data.user.id;

    const sessionId = randomUUID();
    const { error: sessionError } = await adminClient.from('sessions').insert({
      id: sessionId,
      host_id: hostId,
      type: 'solo',
      duration_mode: 'fixed',
      planned_duration_minutes: 30,
    });
    if (sessionError !== null) {
      throw new Error(`failed to create test session: ${sessionError.message}`);
    }

    // Realtime's Postgres Changes stream respects RLS on the SUBSCRIBING
    // connection, same as any other read — an anon (unauthenticated)
    // client has no SELECT grant on these tables at all, so it would never
    // receive the event. Signing in as the host (a real participant, per
    // is_session_participant()) is what makes this representative of the
    // real app rather than a false pass.
    const subscriberClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const signedIn = await subscriberClient.auth.signInWithPassword({ email, password });
    if (signedIn.error !== null || signedIn.data.session === null) {
      throw new Error(`failed to sign in test user: ${signedIn.error?.message}`);
    }
    // Explicit, rather than relying on signInWithPassword's implicit
    // propagation to the realtime socket — a race here (auth applied
    // after the channel already subscribed) is exactly what made this
    // test flaky when run right after another test in the same file.
    subscriberClient.realtime.setAuth(signedIn.data.session.access_token);

    try {
      const channel = subscriberClient.channel(`session:${sessionId}`);
      const received = new Promise((resolve) => {
        channel.on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'session_presence_intervals',
            filter: `session_id=eq.${sessionId}`,
          },
          (payload) => resolve(payload),
        );
      });
      await waitForSubscribed(channel);
      // The walsender can take a moment to attach the new subscription
      // after the client-side 'SUBSCRIBED' callback fires — a write
      // immediately after subscribing can race ahead of it. Empirically
      // flaky at 500ms under load from a full test-suite run; 1.5s has
      // proven reliable.
      await sleep(1500);

      const { error: insertError } = await adminClient
        .from('session_presence_intervals')
        .insert({ session_id: sessionId, user_id: hostId });
      if (insertError !== null) {
        throw new Error(`failed to insert presence interval: ${insertError.message}`);
      }

      const payload = (await received) as { new: { session_id: string; user_id: string } };
      expect(payload.new.session_id).toBe(sessionId);
      expect(payload.new.user_id).toBe(hostId);

      await subscriberClient.removeChannel(channel);
    } finally {
      await subscriberClient.auth.signOut();
    }
    // Own timeout, longer than the file-level jest.setTimeout(30000):
    // CDC delivery timing under load from a full test-suite run has shown
    // occasional flakiness at 30s (walsender attach + auth propagation are
    // both variable, not fully deterministic).
  }, 45000);
});
