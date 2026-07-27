import type { JWTVerifyGetKey } from 'jose';
import { SignJWT, createLocalJWKSet, exportJWK, generateKeyPair } from 'jose';

// Test-only stand-in for services/supabase-jwks.ts: an offline JWKS built
// from a freshly generated ES256 keypair, so tests exercise the same
// signature-verification code path require-auth uses against the real
// Supabase JWKS, without any network call.
export interface TestJwks {
  readonly getKey: JWTVerifyGetKey;
  mintToken(overrides?: { sub?: string; exp?: string | number }): Promise<string>;
}

const KEY_ID = 'test-key';

export const createTestJwks = async (): Promise<TestJwks> => {
  const { privateKey, publicKey } = await generateKeyPair('ES256', { extractable: true });
  const jwk = await exportJWK(publicKey);
  const getKey = createLocalJWKSet({ keys: [{ ...jwk, kid: KEY_ID, alg: 'ES256', use: 'sig' }] });

  const mintToken = async (
    overrides: { sub?: string; exp?: string | number } = {},
  ): Promise<string> =>
    new SignJWT({ role: 'authenticated' })
      .setProtectedHeader({ alg: 'ES256', kid: KEY_ID })
      .setSubject(overrides.sub ?? 'user-123')
      .setIssuedAt()
      .setExpirationTime(overrides.exp ?? '1h')
      .sign(privateKey);

  return { getKey, mintToken };
};
