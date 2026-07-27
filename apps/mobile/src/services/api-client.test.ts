// Typed fetch wrapper for the Node API's WRITE endpoints (create/join/leave
// a session) — the money-equivalent boundary, never called directly from a
// screen. Reads are a different path entirely (session-repository.ts, direct
// RLS-protected Supabase reads) — this module is ONLY for writes that must
// go through the server (.claude/skills/supabase-integration/SKILL.md).
// Mirrors auth-service.ts's never-throws Result convention.

const mockGetState = jest.fn();
jest.mock('../state/auth-store', () => ({
  useAuthStore: { getState: () => mockGetState() },
}));

import { createSession, joinSession, leaveSession } from './api-client';

const AUTHENTICATED = {
  auth: {
    status: 'authenticated',
    session: { accessToken: 'token-abc', refreshToken: 'r', user: { id: 'user-1', email: 'a@b.com' } },
  },
};
const UNAUTHENTICATED = { auth: { status: 'unauthenticated' } };

const mockFetch = jest.fn();

beforeEach(() => {
  mockGetState.mockReturnValue(AUTHENTICATED);
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

describe('createSession', () => {
  it('sends the bearer token and request body, returning the parsed session on success', async () => {
    const session = { id: 's1', hostId: 'user-1', qrToken: null };
    mockFetch.mockResolvedValue(jsonResponse(201, session));

    const result = await createSession({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(result).toEqual({ ok: true, value: session });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-abc');
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'solo',
      duration_mode: 'fixed',
      planned_duration_minutes: 30,
    });
  });

  it('maps a server error envelope to a typed failure, code preserved', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(400, { error: { code: 'invalid_request', message: 'bad body' } }),
    );

    const result = await createSession({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(result).toEqual({ ok: false, error: { code: 'invalid_request', message: 'bad body' } });
  });

  it('never calls fetch when there is no authenticated session', async () => {
    mockGetState.mockReturnValue(UNAUTHENTICATED);

    const result = await createSession({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(result).toEqual({ ok: false, error: { code: 'unauthenticated', message: 'No active session' } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps a network failure (fetch throws) to a typed failure, never throwing itself', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const result = await createSession({ type: 'solo', duration_mode: 'fixed', planned_duration_minutes: 30 });

    expect(result).toEqual({ ok: false, error: { code: 'network_error', message: 'offline' } });
  });
});

describe('joinSession', () => {
  it('posts the QR token to /sessions/join', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { sessionId: 's1' }));

    const result = await joinSession('qr-token-value');

    expect(result).toEqual({ ok: true, value: { sessionId: 's1' } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/join');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'qr-token-value' });
  });

  it.each`
    code                     | expectedCode
    ${'session_not_found'}   | ${'session_not_found'}
    ${'qr_token_expired'}    | ${'qr_token_expired'}
    ${'session_at_capacity'} | ${'session_at_capacity'}
    ${'invalid_qr_token'}    | ${'invalid_qr_token'}
  `('surfaces the $code failure code from the server untouched', async ({ code, expectedCode }) => {
    mockFetch.mockResolvedValue(jsonResponse(409, { error: { code, message: 'nope' } }));

    const result = await joinSession('qr-token-value');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(expectedCode);
  });
});

describe('leaveSession', () => {
  it('posts the reason to /sessions/:id/leave', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { left: true }));

    const result = await leaveSession('session-1', 'emergency_exit');

    expect(result).toEqual({ ok: true, value: { left: true } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/session-1/leave');
    expect(JSON.parse(init.body as string)).toEqual({ reason: 'emergency_exit' });
  });
});
