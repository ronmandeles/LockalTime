import { createClient } from '@supabase/supabase-js';

import { TEST_ENV as env } from '../test-support/fixtures';
import { getSupabaseAdminClient, resetSupabaseAdminClientForTests } from './supabase-admin';

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn().mockReturnValue({ __mockClient: true }),
}));

describe('getSupabaseAdminClient', () => {
  afterEach(() => {
    resetSupabaseAdminClientForTests();
    jest.clearAllMocks();
  });

  it('constructs the client with the service-role key, never the anon key', () => {
    getSupabaseAdminClient(env);

    expect(createClient).toHaveBeenCalledWith(
      env.SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      expect.objectContaining({
        auth: expect.objectContaining({ autoRefreshToken: false, persistSession: false }),
      }),
    );
  });

  it('memoizes the client — a second call does not construct a new one', () => {
    const first = getSupabaseAdminClient(env);
    const second = getSupabaseAdminClient(env);

    expect(first).toBe(second);
    expect(createClient).toHaveBeenCalledTimes(1);
  });
});
