import { mintQrToken, verifyQrToken } from './qr-token';

const SECRET = 'qr-signing-secret-at-least-32-characters-long';
const SESSION_ID = '77777777-7777-7777-7777-777777777777';

describe('qr-token', () => {
  it('verifies a token it minted, recovering the session id', () => {
    const token = mintQrToken(SESSION_ID, SECRET);

    expect(verifyQrToken(token, SECRET)).toEqual({ sessionId: SESSION_ID });
  });

  it('mints a different token each time for the same session (regeneration invalidates the old one)', () => {
    const first = mintQrToken(SESSION_ID, SECRET);
    const second = mintQrToken(SESSION_ID, SECRET);

    expect(first).not.toBe(second);
  });

  it('rejects a token verified with the wrong secret', () => {
    const token = mintQrToken(SESSION_ID, SECRET);

    expect(verifyQrToken(token, 'a-completely-different-secret-value-here')).toBeNull();
  });

  it('rejects a tampered payload even if the signature segment is untouched', () => {
    const token = mintQrToken(SESSION_ID, SECRET);
    const [payload, signature] = token.split('.');
    const tampered = `${payload}xx.${signature}`;

    expect(verifyQrToken(tampered, SECRET)).toBeNull();
  });

  it('rejects a malformed token', () => {
    expect(verifyQrToken('not-a-real-token', SECRET)).toBeNull();
    expect(verifyQrToken('', SECRET)).toBeNull();
  });
});
