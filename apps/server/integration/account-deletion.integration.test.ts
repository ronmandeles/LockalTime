/**
 * @jest-environment node
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import request from 'supertest';
import type { Express } from 'express';

import { createApp } from '../src/app';
import { loadEnv, type Env } from '../src/config/env';

// Real DELETE /account against the LOCAL Supabase stack (Phase 7) -- proves
// the whole Node + real-DB path: the admin API call actually removes the
// auth.users row, and the pgTAP-proven cascade chain
// (20260801000000_account_deletion_cascades.sql) actually fires end to end,
// not just when called directly in SQL.
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

describe('account deletion integration (local Supabase)', () => {
  it('deletes the auth.users row and every dependent public.users row for a user with real session history', async () => {
    const host = await createTestUserAndToken('accountdeletehost');

    const createResponse = await request(app)
      .post('/sessions')
      .set('Authorization', `Bearer ${host.token}`)
      .send({ type: 'dynamic_qr', duration_mode: 'open_ended' })
      .expect(201);
    const sessionId = createResponse.body.id as string;
    await request(app)
      .post(`/sessions/${sessionId}/end`)
      .set('Authorization', `Bearer ${host.token}`)
      .expect(200);

    const deleteResponse = await request(app)
      .delete('/account')
      .set('Authorization', `Bearer ${host.token}`);
    expect(deleteResponse.status).toBe(204);

    const { data: authUser } = await adminClient.auth.admin.getUserById(host.userId);
    expect(authUser.user).toBeNull();

    const { data: profileRow } = await adminClient
      .from('users')
      .select('id')
      .eq('id', host.userId)
      .maybeSingle();
    expect(profileRow).toBeNull();

    const { data: sessionRow } = await adminClient
      .from('sessions')
      .select('id')
      .eq('id', sessionId)
      .maybeSingle();
    expect(sessionRow).toBeNull();

    // A retry with the same (still cryptographically valid, since Supabase
    // JWTs are stateless bearer tokens that verify on signature/expiry
    // alone) token must stay idempotent -- the desired end state (no
    // account) already holds, so this must not surface as a failure.
    const retriedDeletion = await request(app)
      .delete('/account')
      .set('Authorization', `Bearer ${host.token}`);
    expect(retriedDeletion.status).toBe(204);
  });
});
