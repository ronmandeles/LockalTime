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

import {
  createSession,
  createVenue,
  deleteAccount,
  getVenueMetrics,
  joinSession,
  joinVenueSession,
  leaveSession,
  listFriendRequests,
  listFriends,
  listVenues,
  markBlockerReady,
  previewSession,
  regenerateVenueQr,
  rejoinSession,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
} from './api-client';

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
  text: async () => JSON.stringify(body),
});

// 204 No Content — Phase 7's DELETE /account, the first endpoint with no
// response body at all on success.
const emptyResponse = (status: number) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    throw new Error('should never be called for an empty body — use text()');
  },
  text: async () => '',
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

describe('joinVenueSession', () => {
  it('posts the token to /sessions/join-venue', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { sessionId: 's1' }));

    const result = await joinVenueSession('venue-token-value');

    expect(result).toEqual({ ok: true, value: { sessionId: 's1' } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/join-venue');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'venue-token-value' });
  });

  it('surfaces no_active_session_at_venue untouched', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(404, { error: { code: 'no_active_session_at_venue', message: 'nope' } }),
    );

    const result = await joinVenueSession('venue-token-value');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('no_active_session_at_venue');
  });
});

describe('previewSession', () => {
  it('posts the token to /sessions/preview', async () => {
    const preview = {
      sessionId: 's1',
      tokenKind: 'session',
      type: 'dynamic_qr',
      durationMode: 'fixed',
      plannedDurationMinutes: 30,
      status: 'active',
      startedAt: '2026-07-29T12:00:00.000Z',
      elapsedMinutes: 5,
      participantCount: 3,
      venueName: null,
      completionBonusAvailable: false,
    };
    mockFetch.mockResolvedValue(jsonResponse(200, preview));

    const result = await previewSession('qr-token-value');

    expect(result).toEqual({ ok: true, value: preview });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/preview');
    expect(JSON.parse(init.body as string)).toEqual({ token: 'qr-token-value' });
  });

  it.each`
    code                            | expectedCode
    ${'invalid_qr_token'}           | ${'invalid_qr_token'}
    ${'session_not_found'}          | ${'session_not_found'}
    ${'venue_not_found'}            | ${'venue_not_found'}
    ${'no_active_session_at_venue'} | ${'no_active_session_at_venue'}
  `('surfaces the $code failure code from the server untouched', async ({ code, expectedCode }) => {
    mockFetch.mockResolvedValue(jsonResponse(404, { error: { code, message: 'nope' } }));

    const result = await previewSession('qr-token-value');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe(expectedCode);
  });
});

describe('rejoinSession', () => {
  it('posts to /sessions/:id/rejoin with no body — no token to send', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { sessionId: 's1' }));

    const result = await rejoinSession('s1');

    expect(result).toEqual({ ok: true, value: { sessionId: 's1' } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/s1/rejoin');
    expect(JSON.parse(init.body as string)).toEqual({});
  });

  it.each`
    code                          | expectedCode
    ${'session_not_found'}        | ${'session_not_found'}
    ${'session_not_joinable'}     | ${'session_not_joinable'}
    ${'not_a_prior_participant'}  | ${'not_a_prior_participant'}
    ${'session_at_capacity'}      | ${'session_at_capacity'}
  `('surfaces the $code failure code from the server untouched', async ({ code, expectedCode }) => {
    mockFetch.mockResolvedValue(jsonResponse(409, { error: { code, message: 'nope' } }));

    const result = await rejoinSession('s1');

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

describe('markBlockerReady', () => {
  it('posts to /sessions/:id/blocker-ready', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { ok: true }));

    const result = await markBlockerReady('session-1');

    expect(result).toEqual({ ok: true, value: { ok: true } });
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sessions/session-1/blocker-ready');
  });

  it('never throws when the request fails — callers fire-and-forget this', async () => {
    mockFetch.mockRejectedValue(new Error('offline'));

    const result = await markBlockerReady('session-1');

    expect(result.ok).toBe(false);
  });
});

describe('createSession — venue_id (Phase 6)', () => {
  it('includes venue_id in the request body when provided', async () => {
    mockFetch.mockResolvedValue(jsonResponse(201, { id: 's1', venueId: 'venue-1' }));

    await createSession({
      type: 'static_qr',
      duration_mode: 'open_ended',
      venue_id: 'venue-1',
    });

    const [, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      type: 'static_qr',
      duration_mode: 'open_ended',
      venue_id: 'venue-1',
    });
  });

  it('surfaces venue_not_owned/venue_not_found untouched', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(403, { error: { code: 'venue_not_owned', message: 'nope' } }),
    );

    const result = await createSession({
      type: 'static_qr',
      duration_mode: 'open_ended',
      venue_id: 'venue-1',
    });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('venue_not_owned');
  });
});

describe('createVenue', () => {
  it('posts the venue name to /venues, owner_id decided server-side', async () => {
    const venue = {
      id: 'venue-1',
      ownerId: 'user-1',
      name: "Joe's Cafe",
      addressLabel: null,
      qrToken: 'a-signed-venue-token',
      qrTokenIssuedAt: '2026-07-29T00:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    mockFetch.mockResolvedValue(jsonResponse(201, venue));

    const result = await createVenue({ name: "Joe's Cafe" });

    expect(result).toEqual({ ok: true, value: venue });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/venues');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ name: "Joe's Cafe" });
  });

  it('surfaces insufficient_role untouched for a non-verified-host caller', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(403, { error: { code: 'insufficient_role', message: 'nope' } }),
    );

    const result = await createVenue({ name: 'Sneaky Cafe' });

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('insufficient_role');
  });
});

describe('listVenues', () => {
  it('issues a GET request with no body', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { venues: [] }));

    const result = await listVenues();

    expect(result).toEqual({ ok: true, value: { venues: [] } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/venues');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
  });
});

describe('regenerateVenueQr', () => {
  it('posts to /venues/:id/qr/regenerate', async () => {
    const venue = {
      id: 'venue-1',
      ownerId: 'user-1',
      name: 'Cafe',
      addressLabel: null,
      qrToken: 'a-new-signed-venue-token',
      qrTokenIssuedAt: '2026-07-29T01:00:00.000Z',
      createdAt: '2026-07-29T00:00:00.000Z',
    };
    mockFetch.mockResolvedValue(jsonResponse(200, venue));

    const result = await regenerateVenueQr('venue-1');

    expect(result).toEqual({ ok: true, value: venue });
    const [url] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/venues/venue-1/qr/regenerate');
  });
});

describe('getVenueMetrics', () => {
  it('issues a GET to /venues/:id/metrics', async () => {
    const metrics = {
      concurrentActiveCustomers: 3,
      sessionsInWindow: 12,
      avgMinutesPerCustomer: 27.5,
      windowDays: 30,
    };
    mockFetch.mockResolvedValue(jsonResponse(200, metrics));

    const result = await getVenueMetrics('venue-1');

    expect(result).toEqual({ ok: true, value: metrics });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/venues/venue-1/metrics');
    expect(init.method).toBe('GET');
  });

  it("surfaces venue_not_owned untouched for another host's venue", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(403, { error: { code: 'venue_not_owned', message: 'nope' } }),
    );

    const result = await getVenueMetrics('venue-1');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('venue_not_owned');
  });
});

describe('searchUsers', () => {
  it('issues a GET with the query string, url-encoded', async () => {
    const results = [
      { id: 'user-2', username: 'alice', displayName: 'Alice', avatarUrl: null, relationship: 'none' },
    ];
    mockFetch.mockResolvedValue(jsonResponse(200, { results }));

    const result = await searchUsers('ali ce');

    expect(result).toEqual({ ok: true, value: { results } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/friends/search?q=ali%20ce');
    expect(init.method).toBe('GET');
  });

  it('surfaces query_too_short untouched', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(400, { error: { code: 'query_too_short', message: 'too short' } }),
    );

    const result = await searchUsers('a');

    expect(result.ok).toBe(false);
    expect(!result.ok && result.error.code).toBe('query_too_short');
  });
});

describe('listFriendRequests', () => {
  it('issues a GET with no body', async () => {
    const pending = { incoming: [], outgoing: [] };
    mockFetch.mockResolvedValue(jsonResponse(200, pending));

    const result = await listFriendRequests();

    expect(result).toEqual({ ok: true, value: pending });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/friends/requests');
    expect(init.method).toBe('GET');
  });
});

describe('sendFriendRequest', () => {
  it('posts recipientId to /friends/requests', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'requested' }));

    const result = await sendFriendRequest('user-2');

    expect(result).toEqual({ ok: true, value: { status: 'requested' } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/friends/requests');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ recipientId: 'user-2' });
  });

  it('reports a mutual double-request as an immediate friendship', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'friends' }));

    const result = await sendFriendRequest('user-2');

    expect(result).toEqual({ ok: true, value: { status: 'friends' } });
  });
});

describe('respondToFriendRequest', () => {
  it('posts accept to /friends/requests/:id/respond', async () => {
    mockFetch.mockResolvedValue(jsonResponse(200, { status: 'accepted' }));

    const result = await respondToFriendRequest('req-1', true);

    expect(result).toEqual({ ok: true, value: { status: 'accepted' } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/friends/requests/req-1/respond');
    expect(JSON.parse(init.body as string)).toEqual({ accept: true });
  });
});

describe('listFriends', () => {
  it('issues a GET returning the pre-sorted leaderboard', async () => {
    const leaderboard = [
      {
        id: 'user-1',
        username: 'me',
        displayName: 'Me',
        avatarUrl: null,
        totalPoints: 100,
        hadSessionToday: false,
        isSelf: true,
      },
    ];
    mockFetch.mockResolvedValue(jsonResponse(200, { leaderboard }));

    const result = await listFriends();

    expect(result).toEqual({ ok: true, value: { leaderboard } });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/friends');
    expect(init.method).toBe('GET');
  });
});

describe('deleteAccount', () => {
  it('issues a DELETE to /account with no body, handling the 204 No Content response', async () => {
    mockFetch.mockResolvedValue(emptyResponse(204));

    const result = await deleteAccount();

    expect(result).toEqual({ ok: true, value: {} });
    const [url, init] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/account');
    expect(init.method).toBe('DELETE');
    expect(init.body).toBeUndefined();
  });

  it('never calls fetch when there is no authenticated session', async () => {
    mockGetState.mockReturnValue(UNAUTHENTICATED);

    const result = await deleteAccount();

    expect(result).toEqual({ ok: false, error: { code: 'unauthenticated', message: 'No active session' } });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('maps a server error envelope to a typed failure', async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(500, { error: { code: 'account_deletion_failed', message: 'nope' } }),
    );

    const result = await deleteAccount();

    expect(result).toEqual({ ok: false, error: { code: 'account_deletion_failed', message: 'nope' } });
  });
});
