import { setup } from 'xstate';

// Real session lifecycle graph per ARCHITECTURE.md §6, replacing the Phase 0
// placeholder. Sessions are NOT linear (created -> active -> completed) —
// host_disconnected, participant_reconnecting, degraded_offline, and
// force_terminated are first-class states, not booleans layered on top of a
// simple status. useSession (use-session.ts) is the only driver of this
// machine: it translates a REST hydrate + realtime events into the typed
// events below. This machine never talks to the network itself.
export type SessionStatus = 'pending' | 'active' | 'completed' | 'cancelled';

export type SessionLifecycleEvent =
  // Initial REST hydrate result — the only way OUT of `idle`.
  | { type: 'HYDRATED'; status: SessionStatus }
  // Postgres Changes: sessions.status flipped pending -> active.
  | { type: 'SESSION_ACTIVATED' }
  // Postgres Changes: sessions.status flipped to completed/cancelled —
  // both non-punitive server-driven ends collapse to one client state
  // (docs/ARCHITECTURE.md §6 "End reasons"); the specific reason is on the
  // hydrated/CDC session row, not modeled as a separate machine state.
  | { type: 'SESSION_ENDED' }
  // Presence-timeout detection (server) surfaced via Broadcast.
  | { type: 'HOST_DISCONNECTED' }
  // Broadcast: a new host was promoted, session is live again.
  | { type: 'HOST_MIGRATED' }
  // Local network/socket loss — detected client-side, not server-driven.
  | { type: 'CONNECTION_LOST' }
  | { type: 'RECONNECTED' }
  // Native-enforced 30-minute offline cutoff (owned by the native layer
  // per ARCHITECTURE.md §4 — this event only surfaces the result).
  | { type: 'OFFLINE_TIMEOUT' }
  // Server force-closed the session (e.g. the 24h open-ended cap, Phase 4).
  | { type: 'FORCE_TERMINATED' };

export const SessionLifecycleMachine = setup({
  types: {
    events: {} as SessionLifecycleEvent,
  },
}).createMachine({
  id: 'sessionLifecycle',
  initial: 'idle',
  states: {
    idle: {
      on: {
        HYDRATED: [
          { target: 'active', guard: ({ event }) => event.status === 'active' },
          {
            target: 'completed',
            guard: ({ event }) => event.status === 'completed' || event.status === 'cancelled',
          },
          { target: 'pending' },
        ],
      },
    },
    pending: {
      on: {
        SESSION_ACTIVATED: { target: 'active' },
        SESSION_ENDED: { target: 'completed' },
        FORCE_TERMINATED: { target: 'force_terminated' },
      },
    },
    active: {
      on: {
        HOST_DISCONNECTED: { target: 'host_disconnected' },
        CONNECTION_LOST: { target: 'participant_reconnecting' },
        SESSION_ENDED: { target: 'completed' },
        FORCE_TERMINATED: { target: 'force_terminated' },
      },
    },
    host_disconnected: {
      on: {
        HOST_MIGRATED: { target: 'active' },
        SESSION_ENDED: { target: 'completed' },
        FORCE_TERMINATED: { target: 'force_terminated' },
      },
    },
    participant_reconnecting: {
      on: {
        RECONNECTED: { target: 'active' },
        OFFLINE_TIMEOUT: { target: 'degraded_offline' },
        SESSION_ENDED: { target: 'completed' },
      },
    },
    degraded_offline: {
      on: {
        RECONNECTED: { target: 'active' },
        SESSION_ENDED: { target: 'completed' },
      },
    },
    // Terminal states: no `on` handlers, so every event is ignored —
    // matches the DoD's "invalid states unrepresentable" intent (nothing
    // can move a completed/force-terminated session back to life).
    completed: {},
    force_terminated: {},
  },
});
