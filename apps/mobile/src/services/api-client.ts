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

const request = async <T>(path: string, body: unknown): Promise<ApiResult<T>> => {
  const { auth } = useAuthStore.getState();
  if (auth.status !== 'authenticated') {
    return { ok: false, error: { code: 'unauthenticated', message: 'No active session' } };
  }

  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${auth.session.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const parsed: unknown = await response.json();

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
  readonly createdAt: string;
}

export const createSession = (input: CreateSessionInput): Promise<ApiResult<CreateSessionResponse>> =>
  request<CreateSessionResponse>('/sessions', input);

export interface JoinSessionResponse {
  readonly sessionId: string;
}

export const joinSession = (token: string): Promise<ApiResult<JoinSessionResponse>> =>
  request<JoinSessionResponse>('/sessions/join', { token });

export type LeaveReason = 'emergency_exit' | 'involuntary_disconnect';

export interface LeaveSessionResponse {
  readonly left: true;
}

export const leaveSession = (
  sessionId: string,
  reason: LeaveReason,
): Promise<ApiResult<LeaveSessionResponse>> =>
  request<LeaveSessionResponse>(`/sessions/${sessionId}/leave`, { reason });
