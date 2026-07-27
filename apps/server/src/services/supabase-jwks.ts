import type { JWTVerifyGetKey } from 'jose';
import { createRemoteJWKSet } from 'jose';

// Supabase's local CLI (and current hosted default) signs access tokens
// asymmetrically (ES256) and publishes the verification key at this
// well-known JWKS endpoint — discovered the hard way: this module
// originally verified against a shared HS256 secret (SUPABASE_JWT_SECRET),
// which is how older self-hosted Supabase projects sign tokens, but every
// real token minted by the local stack turned out to be ES256-signed and
// was rejected until this switched to JWKS. createRemoteJWKSet fetches and
// caches the public key set, refetching only on a cache miss (e.g. a key
// rotation) — so this is still "local" verification after the first call,
// not a round trip on every request.
export const createSupabaseJwks = (supabaseUrl: string): JWTVerifyGetKey =>
  createRemoteJWKSet(new URL('/auth/v1/.well-known/jwks.json', supabaseUrl));
