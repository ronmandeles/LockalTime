import { createHmac, randomBytes, timingSafeEqual } from 'crypto';

// Money-equivalent logic (ARCHITECTURE.md §3/§7, .claude/skills/code-style/SKILL.md):
// this is what proves a join request targets a real, server-minted session.
// Signed only here, on the server, with a secret the client never sees.
//
// Token shape: <base64url(json payload)>.<base64url(hmac-sha256 signature)>.
// The signature proves *we* minted this and nobody edited the payload; it
// does NOT hide the payload's contents (base64 is encoding, not
// encryption) — so nothing secret ever goes in the payload. Expiry lives
// in sessions.qr_expires_at (a DB column, single source of truth), not in
// the token itself.

export interface QrTokenPayload {
  readonly sessionId: string;
}

interface RawPayload extends QrTokenPayload {
  // Random per mint so regenerating a token for the same session produces
  // a different string — otherwise HMAC is deterministic and "regenerate
  // the QR" would silently hand back the exact same token.
  readonly nonce: string;
}

const sign = (payloadB64: string, secret: string): string =>
  createHmac('sha256', secret).update(payloadB64).digest('base64url');

export const mintQrToken = (sessionId: string, secret: string): string => {
  const payload: RawPayload = { sessionId, nonce: randomBytes(9).toString('base64url') };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${payloadB64}.${sign(payloadB64, secret)}`;
};

export const verifyQrToken = (token: string, secret: string): QrTokenPayload | null => {
  const parts = token.split('.');
  if (parts.length !== 2) {
    return null;
  }
  const [payloadB64, signature] = parts;
  const expected = Buffer.from(sign(payloadB64, secret));
  const actual = Buffer.from(signature);
  // Timing-safe comparison: a naive === leaks how many leading bytes
  // matched via response-time differences, letting an attacker forge a
  // valid signature one byte at a time. Lengths must match first —
  // timingSafeEqual throws (rather than returning false) on a length
  // mismatch.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Partial<RawPayload>).sessionId !== 'string'
    ) {
      return null;
    }
    return { sessionId: (parsed as RawPayload).sessionId };
  } catch {
    return null;
  }
};
