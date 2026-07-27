import { createActor } from 'xstate';

import type { SessionLifecycleEvent } from './session-lifecycle-machine';
import { SessionLifecycleMachine } from './session-lifecycle-machine';

type StateName =
  | 'idle'
  | 'pending'
  | 'active'
  | 'host_disconnected'
  | 'participant_reconnecting'
  | 'degraded_offline'
  | 'completed'
  | 'force_terminated';

const ALL_EVENTS: SessionLifecycleEvent[] = [
  { type: 'HYDRATED', status: 'pending' },
  { type: 'HYDRATED', status: 'active' },
  { type: 'HYDRATED', status: 'completed' },
  { type: 'HYDRATED', status: 'cancelled' },
  { type: 'SESSION_ACTIVATED' },
  { type: 'SESSION_ENDED' },
  { type: 'HOST_DISCONNECTED' },
  { type: 'HOST_MIGRATED' },
  { type: 'CONNECTION_LOST' },
  { type: 'RECONNECTED' },
  { type: 'OFFLINE_TIMEOUT' },
  { type: 'FORCE_TERMINATED' },
];

// Drives a fresh actor to the named state via the shortest real event path
// (never by reaching into machine internals) so every table-driven case
// below starts from a state actually reachable the way useSession reaches it.
const EVENT_PATHS: Record<StateName, SessionLifecycleEvent[]> = {
  idle: [],
  pending: [{ type: 'HYDRATED', status: 'pending' }],
  active: [{ type: 'HYDRATED', status: 'active' }],
  host_disconnected: [{ type: 'HYDRATED', status: 'active' }, { type: 'HOST_DISCONNECTED' }],
  participant_reconnecting: [{ type: 'HYDRATED', status: 'active' }, { type: 'CONNECTION_LOST' }],
  degraded_offline: [
    { type: 'HYDRATED', status: 'active' },
    { type: 'CONNECTION_LOST' },
    { type: 'OFFLINE_TIMEOUT' },
  ],
  completed: [{ type: 'HYDRATED', status: 'completed' }],
  force_terminated: [{ type: 'HYDRATED', status: 'active' }, { type: 'FORCE_TERMINATED' }],
};

const actorAt = (state: StateName) => {
  const actor = createActor(SessionLifecycleMachine).start();
  EVENT_PATHS[state].forEach((event) => actor.send(event));
  expect(actor.getSnapshot().value).toBe(state);
  return actor;
};

// The real, intended transition for each (state, event) pair — every
// combination not listed here is expected to be IGNORED (stay in the same
// state), which the table-driven test below asserts exhaustively.
const TRANSITIONS: ReadonlyArray<{
  from: StateName;
  event: SessionLifecycleEvent;
  to: StateName;
}> = [
  { from: 'idle', event: { type: 'HYDRATED', status: 'pending' }, to: 'pending' },
  { from: 'idle', event: { type: 'HYDRATED', status: 'active' }, to: 'active' },
  { from: 'idle', event: { type: 'HYDRATED', status: 'completed' }, to: 'completed' },
  { from: 'idle', event: { type: 'HYDRATED', status: 'cancelled' }, to: 'completed' },
  { from: 'pending', event: { type: 'SESSION_ACTIVATED' }, to: 'active' },
  { from: 'pending', event: { type: 'SESSION_ENDED' }, to: 'completed' },
  { from: 'pending', event: { type: 'FORCE_TERMINATED' }, to: 'force_terminated' },
  { from: 'active', event: { type: 'HOST_DISCONNECTED' }, to: 'host_disconnected' },
  { from: 'active', event: { type: 'CONNECTION_LOST' }, to: 'participant_reconnecting' },
  { from: 'active', event: { type: 'SESSION_ENDED' }, to: 'completed' },
  { from: 'active', event: { type: 'FORCE_TERMINATED' }, to: 'force_terminated' },
  { from: 'host_disconnected', event: { type: 'HOST_MIGRATED' }, to: 'active' },
  { from: 'host_disconnected', event: { type: 'SESSION_ENDED' }, to: 'completed' },
  { from: 'host_disconnected', event: { type: 'FORCE_TERMINATED' }, to: 'force_terminated' },
  { from: 'participant_reconnecting', event: { type: 'RECONNECTED' }, to: 'active' },
  { from: 'participant_reconnecting', event: { type: 'OFFLINE_TIMEOUT' }, to: 'degraded_offline' },
  { from: 'participant_reconnecting', event: { type: 'SESSION_ENDED' }, to: 'completed' },
  { from: 'degraded_offline', event: { type: 'RECONNECTED' }, to: 'active' },
  { from: 'degraded_offline', event: { type: 'SESSION_ENDED' }, to: 'completed' },
];

const ALL_STATES: StateName[] = [
  'idle',
  'pending',
  'active',
  'host_disconnected',
  'participant_reconnecting',
  'degraded_offline',
  'completed',
  'force_terminated',
];

describe('SessionLifecycleMachine', () => {
  it('starts in the idle state', () => {
    const actor = createActor(SessionLifecycleMachine).start();
    expect(actor.getSnapshot().value).toBe('idle');
    actor.stop();
  });

  describe('defined transitions', () => {
    it.each(TRANSITIONS.map((t) => [t.from, t.event.type, t.to, t] as const))(
      '%s + %s -> %s',
      (_from, _eventType, _to, transition) => {
        const actor = actorAt(transition.from);

        actor.send(transition.event);

        expect(actor.getSnapshot().value).toBe(transition.to);
        actor.stop();
      },
    );
  });

  describe('every other (state, event) pair is ignored', () => {
    const definedPairs = new Set(TRANSITIONS.map((t) => `${t.from}:${t.event.type}:${JSON.stringify(t.event)}`));

    const ignoredCases = ALL_STATES.flatMap((state) =>
      ALL_EVENTS.filter((event) => !definedPairs.has(`${state}:${event.type}:${JSON.stringify(event)}`)).map(
        (event) => ({ state, event }),
      ),
    );

    it.each(ignoredCases.map(({ state, event }) => [state, JSON.stringify(event), state, event] as const))(
      '%s ignores %s (stays %s)',
      (_state, _eventLabel, expectedState, event) => {
        const actor = actorAt(expectedState);

        actor.send(event);

        expect(actor.getSnapshot().value).toBe(expectedState);
        actor.stop();
      },
    );
  });
});
