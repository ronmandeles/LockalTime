import { useEffect, useRef, useState } from 'react';

import { createActor } from 'xstate';

import { SessionLifecycleMachine } from '../machines/session-lifecycle-machine';
import type { SessionLifecycleEvent } from '../machines/session-lifecycle-machine';
import { subscribeToSessionChannel } from '../services/session-channel';
import { fetchOpenPresenceIntervals, fetchSession } from '../services/session-repository';
import type { PresenceIntervalRow, SessionRow } from '../services/session-repository';

export interface UseSessionResult {
  readonly session: SessionRow | null;
  readonly openIntervals: readonly PresenceIntervalRow[];
  readonly status: string;
  // Forwards the native-enforced 30-min offline cutoff (Phase 3's
  // useAppBlocker, ARCHITECTURE.md §4) into the machine's OFFLINE_TIMEOUT
  // event. The actor itself stays private to this hook — this is a send,
  // not a handle — so useSession remains "the only driver" of the machine.
  // Safe to call from any status (including after unmount): a no-op if the
  // current state has no handler for it, or if the actor already stopped.
  readonly reportOfflineTimeout: () => void;
}

interface SessionRowChangePayload {
  readonly new?: SessionRow;
}

// The single place a screen gets session state from (Phase 2 task 2.6).
// Hydrates from a direct REST read FIRST, then subscribes to the realtime
// channel — never the reverse, so a client never trusts an in-memory
// Broadcast/CDC event it might have raced ahead of its own initial read
// (ARCHITECTURE.md §5). Broadcast handlers below only ever drive the state
// machine, never set `session`/`openIntervals` directly — those two only
// ever come from a REST read (initial or CDC-triggered re-fetch), because
// Broadcast is a UI hint, never a source of trusted state
// (.claude/skills/supabase-integration/SKILL.md).
export const useSession = (sessionId: string): UseSessionResult => {
  const [session, setSession] = useState<SessionRow | null>(null);
  const [openIntervals, setOpenIntervals] = useState<readonly PresenceIntervalRow[]>([]);
  const [status, setStatus] = useState<string>('idle');

  // Holds the current effect's actor so reportOfflineTimeout (a stable
  // function identity, safe to pass to useAppBlocker as a dependency) can
  // reach it without itself becoming a dependency that recreates the
  // effect. Never read outside this hook — the actor stays private.
  const actorRef = useRef<{ send: (event: SessionLifecycleEvent) => void } | null>(null);
  const reportOfflineTimeout = useRef((): void => {
    actorRef.current?.send({ type: 'OFFLINE_TIMEOUT' });
  }).current;

  useEffect(() => {
    let cancelled = false;
    const actor = createActor(SessionLifecycleMachine).start();
    actorRef.current = actor;
    const actorSubscription = actor.subscribe((snapshot) => {
      if (!cancelled) {
        setStatus(String(snapshot.value));
      }
    });

    const refreshOpenIntervals = (): void => {
      fetchOpenPresenceIntervals(sessionId)
        .then((result) => {
          if (!cancelled && result.ok) {
            setOpenIntervals(result.value);
          }
        })
        .catch(() => undefined);
    };

    let channelHandle: { unsubscribe: () => Promise<void> } | null = null;

    const hydrateAndSubscribe = async (): Promise<void> => {
      const [sessionResult, intervalsResult] = await Promise.all([
        fetchSession(sessionId),
        fetchOpenPresenceIntervals(sessionId),
      ]);
      if (cancelled) {
        return;
      }

      if (sessionResult.ok) {
        setSession(sessionResult.value);
        actor.send({ type: 'HYDRATED', status: sessionResult.value.status });
      }
      if (intervalsResult.ok) {
        setOpenIntervals(intervalsResult.value);
      }

      channelHandle = subscribeToSessionChannel(sessionId, {
        onSessionRowChange: (payload) => {
          const newRow = (payload as SessionRowChangePayload).new;
          if (newRow === undefined) {
            return;
          }
          setSession(newRow);
          if (newRow.status === 'active') {
            actor.send({ type: 'SESSION_ACTIVATED' });
          } else if (newRow.status === 'completed' || newRow.status === 'cancelled') {
            actor.send({ type: 'SESSION_ENDED' });
          }
        },
        onPresenceIntervalChange: refreshOpenIntervals,
        onBroadcast: (event) => {
          if (event === 'host_migrated') {
            actor.send({ type: 'HOST_MIGRATED' });
          } else if (event === 'session_ended') {
            actor.send({ type: 'SESSION_ENDED' });
          }
          // participant_joined/participant_left carry no machine
          // transition of their own — the CDC handler above is what
          // actually updates openIntervals when a join/leave lands.
        },
      });
    };

    hydrateAndSubscribe().catch(() => undefined);

    return () => {
      cancelled = true;
      actorSubscription.unsubscribe();
      actor.stop();
      actorRef.current = null;
      channelHandle?.unsubscribe().catch(() => undefined);
    };
  }, [sessionId]);

  return { session, openIntervals, status, reportOfflineTimeout };
};
