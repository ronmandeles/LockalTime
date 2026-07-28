/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Client as PgClient } from 'pg';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';

// Real venue create -> role-gate -> RLS -> static_qr join -> QR
// regeneration against the LOCAL Supabase stack (Phase 6 tasks 0-2). Same
// posture as sessions.integration.test.ts: proves the things a mocked-store
// unit test structurally cannot -- the service_role grants added this
// phase, the tightened venues RLS policy, and the real join_venue_session()
// Postgres function.
//
// NOT part of `npm test` (jest.config.js ignores integration/): run via
// `npm run test:integration` with `npx supabase start` up.
const SUPABASE_URL = 'http://127.0.0.1:54321';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
const SUPABASE_SERVICE_ROLE_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
// Local Supabase CLI's standard demo Postgres connection (`supabase status`
// prints the same values) -- used ONLY here, to do the one thing this
// phase's own design deliberately keeps out of the application layer:
// flipping a user's role. Simulates docs/RUNBOOK_VERIFIED_HOST.md's manual
// SQL step exactly -- the real Node code (service_role's grant is
// select-only, see 20260729000000_grant_users_select_service_role.sql)
// genuinely cannot do this, by design.
const PG_CONNECTION_STRING = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const TEST_PASSWORD = 'Integration-Test-Password-123!';

jest.setTimeout(30000);

let env: Env;
let app: Express;
let adminClient: SupabaseClient;
let pg: PgClient;

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
  pg = new PgClient({ connectionString: PG_CONNECTION_STRING });
  await pg.connect();
});

afterAll(async () => {
  await pg.end();
});

const createTestUserAndToken = async (
  emailPrefix: string,
): Promise<{ userId: string; token: string; client: SupabaseClient }> => {
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

  return {
    userId: created.data.user.id,
    token: signedIn.data.session.access_token,
    client: anonClient,
  };
};

// The runbook's manual SQL, run directly against Postgres — never through
// the Node API, which has no write grant on users.role at all.
const grantVerifiedHost = async (userId: string): Promise<void> => {
  await pg.query("update public.users set role = 'verified_host' where id = $1", [userId]);
};

describe('venues integration (local Supabase)', () => {
  it('a plain user is rejected from POST /venues by the real DB-backed role check', async () => {
    const plainUser = await createTestUserAndToken('plain');

    const response = await request(app)
      .post('/venues')
      .set('Authorization', `Bearer ${plainUser.token}`)
      .send({ name: 'Sneaky Cafe' });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('insufficient_role');
  });

  it('end to end: verified host creates a venue, prints its QR, a customer scans and joins, regeneration invalidates the old code', async () => {
    const host = await createTestUserAndToken('venue-host');
    const otherHost = await createTestUserAndToken('other-host');
    const customer = await createTestUserAndToken('customer');
    await grantVerifiedHost(host.userId);
    await grantVerifiedHost(otherHost.userId);

    // Create the venue.
    const createVenueResponse = await request(app)
      .post('/venues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: "Joe's Cafe", address_label: '123 Main St' });
    expect(createVenueResponse.status).toBe(201);
    const venue = createVenueResponse.body as {
      id: string;
      ownerId: string;
      qrToken: string;
    };
    expect(venue.ownerId).toBe(host.userId);

    // RLS: the owner can read their own venue row directly; a stranger cannot
    // (Phase 6 task 1's tightened policy, proven against the real Data API
    // rather than pgTAP running as postgres).
    const ownRead = await host.client.from('venues').select('id').eq('id', venue.id);
    expect(ownRead.data).toHaveLength(1);
    const strangerRead = await customer.client.from('venues').select('id').eq('id', venue.id);
    expect(strangerRead.data).toHaveLength(0);

    // A session at someone else's venue is rejected — ownership applies to
    // every session type, not just static_qr.
    const wrongOwnerResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${otherHost.token}`)
      .send({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        venue_id: venue.id,
      });
    expect(wrongOwnerResponse.status).toBe(403);
    expect(wrongOwnerResponse.body.error.code).toBe('venue_not_owned');

    // The host starts the venue's static_qr session.
    const createSessionResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'static_qr', duration_mode: 'open_ended', venue_id: venue.id });
    expect(createSessionResponse.status).toBe(201);
    const sessionId = createSessionResponse.body.id as string;

    // The customer scans the printed venue QR and joins.
    const joinResponse = await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });
    expect(joinResponse.status).toBe(201);
    expect(joinResponse.body.sessionId).toBe(sessionId);

    // Scanning again is an idempotent rejoin, not an error.
    const rejoinResponse = await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });
    expect(rejoinResponse.status).toBe(200);
    expect(rejoinResponse.body.sessionId).toBe(sessionId);

    // Regenerating the code invalidates the old printout end to end.
    const regenerateResponse = await request(app)
      .post(`/venues/${venue.id}/qr/regenerate`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(regenerateResponse.status).toBe(200);
    expect(regenerateResponse.body.qrToken).not.toBe(venue.qrToken);

    const staleJoinResponse = await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });
    expect(staleJoinResponse.status).toBe(400);
    expect(staleJoinResponse.body.error.code).toBe('invalid_qr_token');

    // The new code works immediately.
    const secondCustomer = await createTestUserAndToken('customer-2');
    const freshJoinResponse = await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${secondCustomer.token}`)
      .send({ token: regenerateResponse.body.qrToken });
    expect(freshJoinResponse.status).toBe(201);
    expect(freshJoinResponse.body.sessionId).toBe(sessionId);
  });

  it('scanning a venue with no active session returns no_active_session_at_venue', async () => {
    const host = await createTestUserAndToken('idle-venue-host');
    await grantVerifiedHost(host.userId);
    const customer = await createTestUserAndToken('idle-venue-customer');

    const createVenueResponse = await request(app)
      .post('/venues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Quiet Cafe' });
    const venue = createVenueResponse.body as { qrToken: string };

    const joinResponse = await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });

    expect(joinResponse.status).toBe(404);
    expect(joinResponse.body.error.code).toBe('no_active_session_at_venue');
  });
});

describe('session preview (Phase 6 task 4)', () => {
  it('previews a dynamic_qr session via its own session token, before joining', async () => {
    const host = await createTestUserAndToken('preview-host');
    const stranger = await createTestUserAndToken('preview-stranger');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'fixed', planned_duration_minutes: 30 });
    const session = createResponse.body as { id: string; qrToken: string };

    // A stranger who has never joined can still preview it — is_session_participant()
    // would deny them a direct RLS read of the sessions row, which is
    // exactly why this is a Node endpoint rather than a client read.
    const previewResponse = await request(app)
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${stranger.token}`)
      .send({ token: session.qrToken });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toMatchObject({
      sessionId: session.id,
      type: 'dynamic_qr',
      status: 'active',
      participantCount: 1, // the host's own presence interval
      venueName: null,
      completionBonusAvailable: true, // previewed immediately after creation
    });
  });

  it('previews a venue token by resolving its active static_qr session, including the venue name', async () => {
    const host = await createTestUserAndToken('preview-venue-host');
    await grantVerifiedHost(host.userId);
    const customer = await createTestUserAndToken('preview-venue-customer');

    const venueResponse = await request(app)
      .post('/venues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Preview Cafe' });
    const venue = venueResponse.body as { id: string; qrToken: string };

    const sessionResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'static_qr', duration_mode: 'open_ended', venue_id: venue.id });
    const session = sessionResponse.body as { id: string };

    const previewResponse = await request(app)
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });

    expect(previewResponse.status).toBe(200);
    expect(previewResponse.body).toMatchObject({
      sessionId: session.id,
      type: 'static_qr',
      venueName: 'Preview Cafe',
    });
  });

  it('rejects an invalid token', async () => {
    const user = await createTestUserAndToken('preview-invalid');

    const response = await request(app)
      .post('/sessions/preview')
      .set('Authorization', `Bearer ${user.token}`)
      .send({ token: 'garbage' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_qr_token');
  });
});

describe('venue metrics (Phase 6 task 5)', () => {
  it('reflects a live customer while active, then a finalized visit after the session ends', async () => {
    const host = await createTestUserAndToken('metrics-host');
    const otherHost = await createTestUserAndToken('metrics-other-host');
    const customer = await createTestUserAndToken('metrics-customer');
    await grantVerifiedHost(host.userId);
    await grantVerifiedHost(otherHost.userId);

    const venueResponse = await request(app)
      .post('/venues')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ name: 'Metrics Integration Cafe' });
    const venue = venueResponse.body as { id: string; qrToken: string };

    const sessionResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'static_qr', duration_mode: 'open_ended', venue_id: venue.id });
    const session = sessionResponse.body as { id: string };

    await request(app)
      .post('/sessions/join-venue')
      .set('Authorization', `Bearer ${customer.token}`)
      .send({ token: venue.qrToken });

    const liveMetricsResponse = await request(app)
      .get(`/venues/${venue.id}/metrics`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(liveMetricsResponse.status).toBe(200);
    // The host's own presence interval + the customer's = 2 concurrently open.
    expect(liveMetricsResponse.body.concurrentActiveCustomers).toBe(2);

    // Another verified host can never read THIS venue's metrics.
    const wrongHostResponse = await request(app)
      .get(`/venues/${venue.id}/metrics`)
      .set('Authorization', `Bearer ${otherHost.token}`);
    expect(wrongHostResponse.status).toBe(403);
    expect(wrongHostResponse.body.error.code).toBe('venue_not_owned');

    await request(app)
      .post(`/sessions/${session.id}/end`)
      .set('Authorization', `Bearer ${host.token}`);

    const finalMetricsResponse = await request(app)
      .get(`/venues/${venue.id}/metrics`)
      .set('Authorization', `Bearer ${host.token}`);
    expect(finalMetricsResponse.status).toBe(200);
    expect(finalMetricsResponse.body.concurrentActiveCustomers).toBe(0);
    expect(finalMetricsResponse.body.sessionsInWindow).toBeGreaterThanOrEqual(1);
    expect(finalMetricsResponse.body.avgMinutesPerCustomer).toBeGreaterThanOrEqual(0);
    expect(finalMetricsResponse.body.windowDays).toBe(30);
  });
});
