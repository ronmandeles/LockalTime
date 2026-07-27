import { getSupabaseClient } from './supabase-client';

// Per-session Realtime channel (ARCHITECTURE.md §5), carrying three
// primitives with different trust levels:
//   - Presence: live participant tracking, feeds host-liveness detection.
//     UI hint only.
//   - Broadcast: ephemeral events (join/leave pulses, host_migrated,
//     session_ended, timer ticks). UI hint only — this module is a pure
//     pass-through for these; nothing here is ever trusted for anything
//     that affects points (.claude/skills/supabase-integration/SKILL.md).
//   - Postgres Changes (CDC): durable row changes on `sessions` and
//     `session_presence_intervals` — the only trusted realtime channel.
//     A reconnecting client still hydrates from a REST read first (the
//     useSession hook's job, not this module's); CDC only resumes the
//     live stream from there.

export const sessionChannelName = (sessionId: string): string => `session:${sessionId}`;

const BROADCAST_EVENTS = ['host_migrated', 'session_ended', 'participant_joined', 'participant_left'] as const;
export type SessionBroadcastEvent = (typeof BROADCAST_EVENTS)[number];

export interface SessionChannelHandlers {
  readonly onPresenceSync?: (presenceState: Record<string, unknown[]>) => void;
  readonly onBroadcast?: (event: SessionBroadcastEvent, payload: unknown) => void;
  readonly onSessionRowChange?: (payload: unknown) => void;
  readonly onPresenceIntervalChange?: (payload: unknown) => void;
}

export interface TrackPresenceInput {
  readonly userId: string;
  readonly isHost: boolean;
}

export interface SessionChannelHandle {
  trackPresence(input: TrackPresenceInput): Promise<void>;
  unsubscribe(): Promise<void>;
}

export const subscribeToSessionChannel = (
  sessionId: string,
  handlers: SessionChannelHandlers,
): SessionChannelHandle => {
  const client = getSupabaseClient();
  const channel = client.channel(sessionChannelName(sessionId));

  channel.on('presence', { event: 'sync' }, () => {
    handlers.onPresenceSync?.(channel.presenceState());
  });

  BROADCAST_EVENTS.forEach((event) => {
    channel.on('broadcast', { event }, ({ payload }: { payload: unknown }) => {
      handlers.onBroadcast?.(event, payload);
    });
  });

  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'sessions', filter: `id=eq.${sessionId}` },
    (payload: unknown) => {
      handlers.onSessionRowChange?.(payload);
    },
  );

  channel.on(
    'postgres_changes',
    {
      event: '*',
      schema: 'public',
      table: 'session_presence_intervals',
      filter: `session_id=eq.${sessionId}`,
    },
    (payload: unknown) => {
      handlers.onPresenceIntervalChange?.(payload);
    },
  );

  channel.subscribe();

  return {
    trackPresence: async ({ userId, isHost }) => {
      await channel.track({ user_id: userId, is_host: isHost, joined_at: new Date().toISOString() });
    },
    unsubscribe: async () => {
      await client.removeChannel(channel);
    },
  };
};
