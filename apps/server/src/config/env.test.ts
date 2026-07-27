import { loadEnv } from './env';

// loadEnv is a pure function (takes a source object, never reads
// process.env itself) so these tests never mutate global state — see
// code-style skill: testable core vs runtime shell. Typed as a plain index
// signature (matching NodeJS.ProcessEnv's shape) so the "missing key"
// cases below can delete an arbitrary key without a TS2537 error.
const validSource: Record<string, string | undefined> = {
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  QR_SIGNING_SECRET: 'qr-signing-secret-at-least-32-characters-long',
};

describe('loadEnv', () => {
  it('returns a typed env with the default PORT when PORT is unset', () => {
    const env = loadEnv(validSource);

    expect(env).toEqual({ ...validSource, PORT: 3000 });
  });

  it('parses PORT when explicitly set', () => {
    const env = loadEnv({ ...validSource, PORT: '4000' });

    expect(env.PORT).toBe(4000);
  });

  it.each(['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'QR_SIGNING_SECRET'])(
    'throws a descriptive error when %s is missing',
    (missingKey) => {
      const rest = { ...validSource };
      delete rest[missingKey];

      expect(() => loadEnv(rest)).toThrow(missingKey);
    },
  );

  it('throws when SUPABASE_URL is not a valid URL', () => {
    expect(() => loadEnv({ ...validSource, SUPABASE_URL: 'not-a-url' })).toThrow('SUPABASE_URL');
  });

  it('throws when PORT is not a number', () => {
    expect(() => loadEnv({ ...validSource, PORT: 'not-a-number' })).toThrow('PORT');
  });
});
