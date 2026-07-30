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

// How long to wait for a delivered event after each write attempt, and the
// total budget across all attempts. The total sits well under the 45s
// per-test timeout below so an exhausted budget throws THIS file's
// descriptive error rather than a bare, undiagnosable jest timeout.
const CDC_ATTEMPT_TIMEOUT_MS = 1000;
const CDC_TOTAL_BUDGET_MS = 30000;

type PresenceRow = { session_id: string; user_id: string };

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// Resolves with the promise's value if it settles within `ms`, else null.
// Deliberately does NOT cancel the underlying promise: the caller races the
// same long-lived `received` across every retry, so an event delivered late
// (from an earlier attempt) still counts on a subsequent pass.
const settleWithin = <T>(promise: Promise<T>, ms: number): Promise<T | null> =>
  Promise.race([promise, sleep(ms).then(() => null)]);

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
      const received = new Promise<{ new: PresenceRow }>((resolve) => {
        channel.on<PresenceRow>(
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

      // 'SUBSCRIBED' is the channel-JOIN ack; it does not guarantee the
      // server-side Postgres CDC subscription is live and consuming WAL. A
      // single write into that gap is MISSED outright rather than merely
      // delayed — which is the observed CI failure shape: a 45s timeout
      // after having waited only 1.5s, never a late delivery. No sleep value
      // fixes a missed window (this one was already re-tuned 500ms -> 1.5s
      // and still failed ~2 runs in 3), so write repeatedly and stop the
      // moment an event is actually observed. Each attempt is a fresh
      // chance; once CDC is live the next insert lands. Synchronizing on the
      // condition, not guessing a duration — and agnostic to WHICH piece
      // (slot attach, poller startup, setAuth propagation) was late.
      //
      // Inserting several rows is harmless: `received` resolves on the first
      // delivered event and every row carries the same session_id/user_id,
      // so the assertions below hold regardless of which insert won.
      const deadline = Date.now() + CDC_TOTAL_BUDGET_MS;
      let attempts = 0;
      let payload: { new: PresenceRow } | null = null;

      while (payload === null && Date.now() < deadline) {
        attempts += 1;
        const { error: insertError } = await adminClient
          .from('session_presence_intervals')
          .insert({ session_id: sessionId, user_id: hostId });
        if (insertError !== null) {
          throw new Error(`failed to insert presence interval: ${insertError.message}`);
        }
        payload = await settleWithin(received, CDC_ATTEMPT_TIMEOUT_MS);
      }

      if (payload === null) {
        throw new Error(
          `no postgres_changes INSERT event for session ${sessionId} after ${attempts} write ` +
            `attempt(s) over ${CDC_TOTAL_BUDGET_MS}ms — the realtime CDC subscription never ` +
            `went live (the table IS in the supabase_realtime publication and the host DOES ` +
            `pass is_session_participant(), so suspect realtime service startup, not config)`,
        );
      }

      expect(payload.new.session_id).toBe(sessionId);
      expect(payload.new.user_id).toBe(hostId);

      await subscriberClient.removeChannel(channel);
    } finally {
      await subscriberClient.auth.signOut();
    }
    // Own timeout, longer than the file-level jest.setTimeout(30000): this
    // test spends up to CDC_TOTAL_BUDGET_MS (30s) on the retry loop alone,
    // plus admin user creation and sign-in. The gap between that budget and
    // this timeout is deliberate — it guarantees the loop's descriptive
    // error fires first, so a real failure names the cause instead of
    // surfacing as a bare jest timeout the way it did in CI.
  }, 45000);
});
