import { API_BASE_URL } from '../config/api-config';
import { useAuthStore } from '../state/auth-store';

// Typed fetch wrapper for the Node API's WRITE endpoints only — create/join/
// leave a session, the money-equivalent boundary
// (.claude/skills/supabase-integration/SKILL.md). Session READS go through
// session-repository.ts instead (direct RLS-protected Supabase reads); never
// add a read function here. Mirrors auth-service.ts's discriminated-result,
// never-throws contract, and its "message is diagnostic only" rule —
// `code` is what screens branch on, matching the server's ApiError contract
// (apps/server/.claude/skills/api-design/SKILL.md).

export interface ApiFailure {
  readonly code: string;
  readonly message: string;
}

export type ApiResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ApiFailure };

interface ServerErrorBody {
  readonly error?: { readonly code?: string; readonly message?: string };
}

// method defaults to POST (every endpoint before Phase 6 was a write); GET
// added for the venues list read (still Node-only, not a direct Supabase
// read — see requestGet's own doc comment for why); DELETE added for Phase
// 7's account deletion, the first endpoint that returns 204 No Content
// rather than a JSON body on success.
const request = async <T>(
  path: string,
  body: unknown,
  method: 'POST' | 'GET' | 'DELETE' = 'POST',
): Promise<ApiResult<T>> => {
  const { auth } = useAuthStore.getState();
  if (auth.status !== 'authenticated') {
    return { ok: false, error: { code: 'unauthenticated', message: 'No active session' } };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.session.accessToken}`,
      },
      ...(method === 'GET' || method === 'DELETE' ? {} : { body: JSON.stringify(body) }),
    });
    // A 204 (or any empty body) has nothing for response.json() to parse —
    // it would throw on valid, successful responses.
    const rawText = await response.text();
    const parsed: unknown = rawText.length > 0 ? JSON.parse(rawText) : {};

    if (!response.ok) {
      const errorBody = parsed as ServerErrorBody;
      return {
        ok: false,
        error: {
          code: errorBody.error?.code ?? 'unknown_error',
          message: errorBody.error?.message ?? 'Request failed',
        },
      };
    }
    return { ok: true, value: parsed as T };
  } catch (thrown) {
    return {
      ok: false,
      error: { code: 'network_error', message: thrown instanceof Error ? thrown.message : 'Network error' },
    };
  }
};

export type SessionType = 'solo' | 'dynamic_qr' | 'static_qr';
export type DurationMode = 'fixed' | 'open_ended';

export interface CreateSessionInput {
  readonly type: SessionType;
  readonly duration_mode: DurationMode;
  readonly planned_duration_minutes?: number;
  // Phase 6: required for static_qr, optional for solo/dynamic_qr — the
  // server's ownership check (venue_not_owned/venue_not_found) applies
  // whenever this is present, regardless of type.
  readonly venue_id?: string;
}

export interface CreateSessionResponse {
  readonly id: string;
  readonly hostId: string;
  readonly venueId: string | null;
  readonly type: SessionType;
  readonly status: 'pending' | 'active' | 'completed' | 'cancelled';
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly qrToken: string | null;
  readonly qrExpiresAt: string | null;
  readonly startedAt: string | null;
  readonly createdAt: string;
}

export const createSession = (input: CreateSessionInput): Promise<ApiResult<CreateSessionResponse>> =>
  request<CreateSessionResponse>('/sessions', input);

export interface JoinSessionResponse {
  readonly sessionId: string;
}

export const joinSession = (token: string): Promise<ApiResult<JoinSessionResponse>> =>
  request<JoinSessionResponse>('/sessions/join', { token });

// Phase 6 task 2/7: the venue-scoped counterpart — SessionDetailsScreen
// calls this instead of joinSession() when previewSession() below reports
// tokenKind: 'venue', since the printed venue code needs its own endpoint
// (a different signing scheme, verified against venues.qr_token, not
// sessions.qr_token).
export const joinVenueSession = (token: string): Promise<ApiResult<JoinSessionResponse>> =>
  request<JoinSessionResponse>('/sessions/join-venue', { token });

// Phase 6 task 4/7: real session details before joining, without a direct
// Supabase read — is_session_participant()'s RLS denies a non-participant
// a session row entirely, so this has to be a Node endpoint (see the
// server's preview-session.ts). Works for both a scanned session token and
// a scanned venue token — the client never needs to know which kind it
// scanned (same token field either way).
export type PreviewTokenKind = 'session' | 'venue';

export interface SessionPreviewResponse {
  readonly sessionId: string;
  readonly tokenKind: PreviewTokenKind;
  readonly type: SessionType;
  readonly durationMode: DurationMode;
  readonly plannedDurationMinutes: number | null;
  readonly status: 'pending' | 'active' | 'completed' | 'cancelled';
  readonly startedAt: string | null;
  readonly elapsedMinutes: number | null;
  readonly participantCount: number;
  readonly venueName: string | null;
  readonly completionBonusAvailable: boolean;
}

export const previewSession = (token: string): Promise<ApiResult<SessionPreviewResponse>> =>
  request<SessionPreviewResponse>('/sessions/preview', { token });

// Token-free counterpart to joinSession — Screen 13's "Welcome Back" flow,
// authorized by prior participation instead of a QR token (see
// apps/server's rejoin_session() migration for why a still-valid token
// can't be assumed after a relaunch or a long offline gap).
export interface RejoinSessionResponse {
  readonly sessionId: string;
}

export const rejoinSession = (sessionId: string): Promise<ApiResult<RejoinSessionResponse>> =>
  request<RejoinSessionResponse>(`/sessions/${sessionId}/rejoin`, {});

export type LeaveReason = 'emergency_exit' | 'involuntary_disconnect';

export interface LeaveSessionResponse {
  readonly left: true;
}

export const leaveSession = (
  sessionId: string,
  reason: LeaveReason,
): Promise<ApiResult<LeaveSessionResponse>> =>
  request<LeaveSessionResponse>(`/sessions/${sessionId}/leave`, { reason });

export interface BlockerReadyResponse {
  readonly ok: true;
}

// Advisory (ARCHITECTURE.md §7's Sybil-resistance gate) — called once
// useAppBlocker's module.start() resolves. Callers should fire-and-forget
// this (never block session UX on it): the server-side endpoint is itself
// best-effort and idempotent, and a failure here only means this
// participant won't count toward the Group Bonus threshold, never that
// they're removed from the session.
export const markBlockerReady = (sessionId: string): Promise<ApiResult<BlockerReadyResponse>> =>
  request<BlockerReadyResponse>(`/sessions/${sessionId}/blocker-ready`, {});

// ── Phase 6: venues (verified_host/admin only — server-enforced) ─────────
// Still Node-only, not a direct Supabase read, despite venues.router.ts's
// GET /venues looking like a "read": listing/creating venues needs the
// role check (requireRole), which RLS alone can't express as cleanly as
// the server-side middleware already built for this — see
// docs/RUNBOOK_VERIFIED_HOST.md and ARCHITECTURE.md §10.

export interface VenueResponse {
  readonly id: string;
  readonly ownerId: string;
  readonly name: string;
  readonly addressLabel: string | null;
  readonly qrToken: string;
  readonly qrTokenIssuedAt: string;
  readonly createdAt: string;
}

export interface CreateVenueInput {
  readonly name: string;
  readonly address_label?: string;
}

export const createVenue = (input: CreateVenueInput): Promise<ApiResult<VenueResponse>> =>
  request<VenueResponse>('/venues', input);

export interface ListVenuesResponse {
  readonly venues: readonly VenueResponse[];
}

export const listVenues = (): Promise<ApiResult<ListVenuesResponse>> =>
  request<ListVenuesResponse>('/venues', undefined, 'GET');

// Always a deliberate, confirmed action (the venue screen asks "are you
// sure?" first) — invalidates the printed code immediately.
export const regenerateVenueQr = (venueId: string): Promise<ApiResult<VenueResponse>> =>
  request<VenueResponse>(`/venues/${venueId}/qr/regenerate`, {});

// ── Phase 6 task 6: B2B dashboard's data source ───────────────────────────
export interface VenueMetricsResponse {
  readonly concurrentActiveCustomers: number;
  readonly sessionsInWindow: number;
  readonly avgMinutesPerCustomer: number;
  readonly windowDays: number;
}

export const getVenueMetrics = (venueId: string): Promise<ApiResult<VenueMetricsResponse>> =>
  request<VenueMetricsResponse>(`/venues/${venueId}/metrics`, undefined, 'GET');

// ── Phase 6.5: friends (search/requests/leaderboard) ──────────────────────
// Still Node-only, not a direct Supabase read: public.users' SELECT policy
// is "own row only" and stays that way (no widening) — searching strangers
// by username and reading a friend's total_points/activity signal both need
// a cross-user read RLS can't express cleanly, the same posture as venue
// metrics/session preview.

export type FriendRelationship = 'none' | 'requested' | 'incoming' | 'friends';

export interface UserSearchResult {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly relationship: FriendRelationship;
}

export interface SearchUsersResponse {
  readonly results: readonly UserSearchResult[];
}

export const searchUsers = (query: string): Promise<ApiResult<SearchUsersResponse>> =>
  request<SearchUsersResponse>(`/friends/search?q=${encodeURIComponent(query)}`, undefined, 'GET');

export interface PendingFriendRequest {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
}

export interface ListFriendRequestsResponse {
  readonly incoming: readonly PendingFriendRequest[];
  readonly outgoing: readonly PendingFriendRequest[];
}

export const listFriendRequests = (): Promise<ApiResult<ListFriendRequestsResponse>> =>
  request<ListFriendRequestsResponse>('/friends/requests', undefined, 'GET');

// requesterId is derived from the verified token server-side, never sent —
// a mutual double-request (the other person already requested you) resolves
// straight to 'friends', same as a real Instagram/Facebook-style system.
export interface SendFriendRequestResponse {
  readonly status: 'requested' | 'already_requested' | 'already_friends' | 'friends';
}

export const sendFriendRequest = (
  recipientId: string,
): Promise<ApiResult<SendFriendRequestResponse>> =>
  request<SendFriendRequestResponse>('/friends/requests', { recipientId });

export interface RespondToFriendRequestResponse {
  readonly status: 'accepted' | 'declined';
}

export const respondToFriendRequest = (
  requestId: string,
  accept: boolean,
): Promise<ApiResult<RespondToFriendRequestResponse>> =>
  request<RespondToFriendRequestResponse>(`/friends/requests/${requestId}/respond`, { accept });

// The leaderboard: caller included (isSelf: true), pre-sorted by
// totalPoints descending. Only totalPoints and a coarse hadSessionToday
// boolean ever cross the boundary for a friend — never their real
// current_streak or anything else user_stats/user_streaks hold (Phase
// 6.5's privacy decision).
export interface FriendLeaderboardEntry {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly totalPoints: number;
  readonly hadSessionToday: boolean;
  readonly isSelf: boolean;
}

export interface ListFriendsResponse {
  readonly leaderboard: readonly FriendLeaderboardEntry[];
}

export const listFriends = (): Promise<ApiResult<ListFriendsResponse>> =>
  request<ListFriendsResponse>('/friends', undefined, 'GET');

// ── Phase 7 (Release Prep): account deletion ──────────────────────────────
// The App/Play Store-mandated deletion path (guideline 5.1.1v). Deletes the
// caller's own account server-side (userId always comes from their verified
// token, never a param — see apps/server's users.router.ts) — every
// dependent row cascades via the schema's FK chain
// (20260801000000_account_deletion_cascades.sql), so there is nothing else
// for the client to clean up beyond signing itself out afterward.
export const deleteAccount = (): Promise<ApiResult<Record<string, never>>> =>
  request<Record<string, never>>('/account', undefined, 'DELETE');
