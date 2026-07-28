import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Money-equivalent logic (ARCHITECTURE.md §3/§7, .claude/skills/code-style/SKILL.md):
// mints/verifies the venue's printed QR token. Same HMAC-SHA256 scheme as
// modules/sessions/qr-token.ts, deliberately kept a separate sibling module
// rather than generalizing that one over a generic payload shape: the two
// tokens have different lifetimes by design (a session token expires in
// QR_TOKEN_TTL_MINUTES; a venue token has NO expiry at all -- it's printed
// once) and different payload keys (venueId vs sessionId), so a garbage
// token can never be misread as the other kind's payload.

export interface VenueQrTokenPayload {
  readonly venueId: string;
}

interface RawPayload extends VenueQrTokenPayload {
  // Random per mint, same reason as qr-token.ts's nonce: regenerating a
  // venue's token (POST /venues/:id/qr/regenerate) must produce a
  // different string, invalidating the old printout.
  readonly nonce: string;
}

const sign = (payloadB64: string, secret: string): string =>
  createHmac('sha256', secret).update(payloadB64).digest('base64url');

export const mintVenueQrToken = (venueId: string, secret: string): string => {
  const payload: RawPayload = { venueId, nonce: randomBytes(9).toString('base64url') };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
};

export const verifyVenueQrToken = (token: string, secret: string): VenueQrTokenPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signature] = parts;
  const expected = Buffer.from(sign(payloadB64, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Partial<RawPayload>).venueId !== 'string'
    ) {
      return null;
    }
    return { venueId: (parsed as RawPayload).venueId };
  } catch {
    return null;
  }
};
