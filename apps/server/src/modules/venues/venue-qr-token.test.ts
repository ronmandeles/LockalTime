import { mintVenueQrToken, verifyVenueQrToken } from './venue-qr-token';

const SECRET = 'qr-signing-secret-at-least-32-characters-long';
const VENUE_ID = '88888888-8888-8888-8888-888888888888';

describe('venue-qr-token', () => {
  it('verifies a token it minted, recovering the venue id', () => {
    const token = mintVenueQrToken(VENUE_ID, SECRET);

    expect(verifyVenueQrToken(token, SECRET)).toEqual({ venueId: VENUE_ID });
  });

  it('mints a different token each time for the same venue (regeneration invalidates the old one)', () => {
    const first = mintVenueQrToken(VENUE_ID, SECRET);
    const second = mintVenueQrToken(VENUE_ID, SECRET);

    expect(first).not.toBe(second);
  });

  it('rejects a token verified with the wrong secret', () => {
    const token = mintVenueQrToken(VENUE_ID, SECRET);

    expect(verifyVenueQrToken(token, 'a-completely-different-secret-value-here')).toBeNull();
  });

  it('rejects a tampered payload even if the signature segment is untouched', () => {
    const token = mintVenueQrToken(VENUE_ID, SECRET);
    const [payload, signature] = token.split('.');
    const tampered = `${payload}xx.${signature}`;

    expect(verifyVenueQrToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyVenueQrToken('not-a-real-token', SECRET)).toBeNull();
    expect(verifyVenueQrToken('', SECRET)).toBeNull();
  });

  it("a venue token's payload is never confused with a session token's — different key entirely", () => {
    const venueToken = mintVenueQrToken(VENUE_ID, SECRET);
    const payloadB64 = venueToken.split('.')[0];
    const decoded: unknown = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));

    expect(decoded).toMatchObject({ venueId: VENUE_ID });
    expect(decoded).not.toHaveProperty('sessionId');
  });
});
