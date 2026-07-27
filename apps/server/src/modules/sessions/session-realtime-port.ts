import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';

// Server-side counterpart to apps/mobile/src/services/session-channel.ts —
// same channel name convention (`session:{sessionId}`), but the server only
// ever needs Presence (for host-liveness detection, ARCHITECTURE.md §5/§6)
// and one outbound Broadcast (host_migrated); it never subscribes to
// Postgres Changes or tracks its own presence key, since the server isn't
// a "participant."
export interface SessionRealtimePort {
  // Idempotent: subscribing to a session sweep.ts is already tracking is a
  // no-op, so the sweep loop can call this unconditionally every tick.
  track(sessionId: string): void;
  untrack(sessionId: string): void;
  // The last time each present user_id was observed in a presence sync for
  // this session. A user who has never appeared at all is simply absent
  // from the map — sweep.ts falls back to a durable reference (their
  // interval's joined_at) rather than treating "never seen yet" as
  // infinitely stale, since there's real latency between a client opening
  // its presence channel and the first sync firing.
  lastSeenAt(sessionId: string): ReadonlyMap<string, Date>;
  broadcastHostMigrated(sessionId: string): Promise<void>;
}

interface PresenceEntry {
  readonly user_id?: string;
}

export const createSupabaseSessionRealtimePort = (client: SupabaseClient): SessionRealtimePort => {
  const channels = new Map<string, RealtimeChannel>();
  const lastSeen = new Map<string, Map<string, Date>>();

  const recordPresence = (sessionId: string, channel: RealtimeChannel): void => {
    const state = channel.presenceState() as Record<string, PresenceEntry[]>;
    const seenForSession = lastSeen.get(sessionId) ?? new Map<string, Date>();
    const now = new Date();
    for (const presences of Object.values(state)) {
      for (const presence of presences) {
        if (typeof presence.user_id === 'string') {
          seenForSession.set(presence.user_id, now);
        }
      }
    }
    lastSeen.set(sessionId, seenForSession);
  };

  return {
    track(sessionId) {
      if (channels.has(sessionId)) {
        return;
      }
      const channel = client.channel(`session:${sessionId}`);
      channel.on('presence', { event: 'sync' }, () => recordPresence(sessionId, channel));
      channel.subscribe();
      channels.set(sessionId, channel);
      lastSeen.set(sessionId, new Map());
    },
    untrack(sessionId) {
      const channel = channels.get(sessionId);
      if (channel !== undefined) {
        client.removeChannel(channel).catch(() => undefined);
        channels.delete(sessionId);
      }
      lastSeen.delete(sessionId);
    },
    lastSeenAt(sessionId) {
      return lastSeen.get(sessionId) ?? new Map();
    },
    async broadcastHostMigrated(sessionId) {
      const channel = channels.get(sessionId);
      if (channel === undefined) {
        return;
      }
      await channel.send({ type: 'broadcast', event: 'host_migrated', payload: {} });
    },
  };
};
