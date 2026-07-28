#!/usr/bin/env node
/**
 * Phase 7 (Release Prep) Realtime load test — backlog.md's "Load-test the
 * Realtime channel" quality gate. Target: 500 concurrent connections,
 * modeling a launch-day mix of ~10 simultaneous venue-scale `static_qr`
 * sessions (VENUE_SESSION_MAX_PARTICIPANTS = 200 is the per-session cap;
 * 10 sessions x 50 participants = 500 is the aggregate scale being tested,
 * not every session literally at its own 200 cap simultaneously).
 *
 * Scope: this drives real `@supabase/supabase-js` Realtime clients (the
 * same library apps/mobile's session-channel.ts uses) against Presence +
 * Broadcast on real channel topics — the two primitives session-channel.ts
 * documents as "UI hint only", not RLS-gated. Postgres Changes (the one
 * *trusted* primitive, per that file's own header) is deliberately NOT
 * exercised here: it requires each simulated client to be a real signed-in,
 * RLS-authorized participant of a real session row, which would mean
 * scripting 500 real signups + session creates/joins just to load-test
 * infrastructure capacity — the wrong tool for that question. This measures
 * what it says it measures: can the Realtime server accept, subscribe, and
 * fan out messages to 500 concurrent WebSocket channel subscriptions.
 *
 * Usage:
 *   node loadtest/realtime-load-test.js
 * Env vars (all optional, default to the local stack):
 *   SUPABASE_URL, SUPABASE_ANON_KEY, NUM_SESSIONS (10), PARTICIPANTS_PER_SESSION (50)
 *
 * NEVER point this at production (same rule as every E2E/load test in this
 * repo, CLAUDE.md) — target local or staging only.
 */

const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  process.env.SUPABASE_ANON_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const NUM_SESSIONS = Number(process.env.NUM_SESSIONS ?? '10');
const PARTICIPANTS_PER_SESSION = Number(process.env.PARTICIPANTS_PER_SESSION ?? '50');
const SUBSCRIBE_TIMEOUT_MS = 15000;
const BROADCAST_WAIT_MS = 10000;

if (SUPABASE_URL.includes('supabase.co') && !SUPABASE_URL.includes('staging')) {
  console.error('Refusing to run: SUPABASE_URL does not look like local/staging. Never load-test production.');
  process.exit(1);
}

const percentile = (sortedValues, p) => {
  if (sortedValues.length === 0) return NaN;
  const index = Math.min(sortedValues.length - 1, Math.floor((p / 100) * sortedValues.length));
  return sortedValues[index];
};

const summarize = (label, values) => {
  const sorted = [...values].sort((a, b) => a - b);
  console.log(
    `${label}: n=${sorted.length} p50=${percentile(sorted, 50)}ms p95=${percentile(sorted, 95)}ms p99=${percentile(sorted, 99)}ms max=${sorted[sorted.length - 1] ?? NaN}ms`,
  );
};

async function subscribeClient(sessionId, clientIndex, onBroadcastReceived) {
  const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 10 } },
  });
  const channel = client.channel(`session:${sessionId}`, {
    config: { broadcast: { self: false } },
  });

  channel.on('broadcast', { event: 'load_test_ping' }, ({ payload }) => {
    onBroadcastReceived(payload.sentAt);
  });

  const start = Date.now();
  let failureReason = null;
  const subscribed = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), SUBSCRIBE_TIMEOUT_MS);
    channel.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        clearTimeout(timer);
        resolve(true);
      } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
        // ConnectionRateLimitReached is a real Supabase Realtime server-side
        // cap on concurrent connections (a plan-tier limit, not a bug in
        // this script or the server itself) -- distinguishing it from a
        // generic transport failure is the whole point of this test.
        failureReason = err?.message ?? err?.name ?? String(status);
        clearTimeout(timer);
        resolve(false);
      }
    });
  });
  const subscribeMs = Date.now() - start;

  return { client, channel, subscribed, subscribeMs, clientIndex, failureReason };
}

async function runSessionCohort(sessionId, sessionIndex, participantsPerSession) {
  const receivedAt = [];
  const onBroadcastReceived = (sentAt) => {
    receivedAt.push(Date.now() - sentAt);
  };

  const clients = await Promise.all(
    Array.from({ length: participantsPerSession }, (_, i) =>
      subscribeClient(sessionId, i, onBroadcastReceived),
    ),
  );

  const subscribed = clients.filter((c) => c.subscribed);
  const failed = clients.length - subscribed.length;

  // One participant in this session broadcasts; everyone else's receipt
  // latency is what gets measured (n-1 expected deliveries).
  if (subscribed.length > 1) {
    const [sender] = subscribed;
    sender.channel.send({
      type: 'broadcast',
      event: 'load_test_ping',
      payload: { sentAt: Date.now() },
    });
    await new Promise((resolve) => setTimeout(resolve, BROADCAST_WAIT_MS));
  }

  await Promise.all(clients.map((c) => c.channel.unsubscribe()));

  return {
    sessionIndex,
    attempted: clients.length,
    subscribedCount: subscribed.length,
    failed,
    subscribeMsValues: clients.map((c) => c.subscribeMs),
    broadcastLatencyValues: receivedAt,
    failureReasons: clients.filter((c) => !c.subscribed).map((c) => c.failureReason),
  };
}

async function main() {
  console.log(
    `Realtime load test: ${NUM_SESSIONS} sessions x ${PARTICIPANTS_PER_SESSION} participants = ${
      NUM_SESSIONS * PARTICIPANTS_PER_SESSION
    } concurrent connections, against ${SUPABASE_URL}`,
  );

  const sessionIds = Array.from({ length: NUM_SESSIONS }, () => crypto.randomUUID());

  const overallStart = Date.now();
  const results = await Promise.all(
    sessionIds.map((sessionId, i) => runSessionCohort(sessionId, i, PARTICIPANTS_PER_SESSION)),
  );
  const overallMs = Date.now() - overallStart;

  const totalAttempted = results.reduce((sum, r) => sum + r.attempted, 0);
  const totalSubscribed = results.reduce((sum, r) => sum + r.subscribedCount, 0);
  const totalFailed = results.reduce((sum, r) => sum + r.failed, 0);
  const allSubscribeMs = results.flatMap((r) => r.subscribeMsValues);
  const allBroadcastLatency = results.flatMap((r) => r.broadcastLatencyValues);
  const allFailureReasons = results.flatMap((r) => r.failureReasons);
  const reasonCounts = allFailureReasons.reduce((acc, reason) => {
    acc[reason] = (acc[reason] ?? 0) + 1;
    return acc;
  }, {});

  console.log('');
  console.log('== Results ==');
  console.log(`Total duration: ${overallMs}ms`);
  console.log(
    `Connections: ${totalSubscribed}/${totalAttempted} subscribed successfully (${totalFailed} failed) — ${(
      (totalSubscribed / totalAttempted) *
      100
    ).toFixed(1)}%`,
  );
  if (Object.keys(reasonCounts).length > 0) {
    console.log('Failure reasons:', JSON.stringify(reasonCounts));
    if (allFailureReasons.some((r) => r?.includes('ConnectionRateLimitReached'))) {
      console.log(
        'NOTE: ConnectionRateLimitReached is a real Supabase Realtime server-side connection cap ' +
          '(a plan-tier limit), not a bug in this script. Confirming true capacity at the target ' +
          'concurrency requires a Supabase plan whose Realtime connection limit supports it — see ' +
          'docs/DEPLOYMENT.md.',
      );
    }
  }
  summarize('Subscribe latency', allSubscribeMs);
  summarize('Broadcast delivery latency', allBroadcastLatency);

  const failureRate = totalFailed / totalAttempted;
  if (failureRate > 0.01) {
    console.error(`FAIL: connection failure rate ${(failureRate * 100).toFixed(1)}% exceeds 1% threshold.`);
    process.exitCode = 1;
  } else {
    console.log('PASS: connection failure rate within threshold.');
  }
}

main()
  .then(() => process.exit(process.exitCode ?? 0))
  .catch((error) => {
    console.error('Load test crashed:', error);
    process.exit(1);
  });
