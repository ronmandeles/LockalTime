import {
  HOST_MIGRATION_PRESENCE_TIMEOUT_SECONDS,
  OPEN_ENDED_SESSION_MAX_HOURS,
  PARTICIPANT_PRESENCE_TIMEOUT_MINUTES,
} from '../../config/constants';
import { endSession } from './end-session';
import type { SessionRealtimePort } from './session-realtime-port';
import type { ActiveSessionSummary, PresenceIntervalRow, SessionsStore } from './sessions-store';

export interface SweepDeps {
  readonly store: SessionsStore;
  readonly realtime: SessionRealtimePort;
  readonly now: () => Date;
}

const minutesSince = (iso: string, nowMs: number): number =>
  (nowMs - new Date(iso).getTime()) / 60_000;

const cumulativeMinutesPresent = (
  userId: string,
  intervals: readonly PresenceIntervalRow[],
  nowMs: number,
): number =>
  intervals
    .filter((interval) => interval.userId === userId)
    .reduce((sum, interval) => {
      const endMs = interval.leftAt !== null ? new Date(interval.leftAt).getTime() : nowMs;
      return sum + (endMs - new Date(interval.joinedAt).getTime()) / 60_000;
    }, 0);

// A session past its planned lifetime force-closes before anything else
// runs for it this tick — no reason to also churn through migration/
// reconciliation for a session that's ending anyway.
const maybeAutoClose = async (
  deps: SweepDeps,
  session: ActiveSessionSummary,
  nowMs: number,
): Promise<boolean> => {
  if (session.startedAt === null) {
    return false; // defensive only — Phase 4 sets startedAt at creation, always
  }
  if (session.durationMode === 'fixed') {
    if (
      session.plannedDurationMinutes !== null &&
      minutesSince(session.startedAt, nowMs) >= session.plannedDurationMinutes
    ) {
      await endSession(
        deps.store,
        session.id,
        { endedBy: null, endReason: 'planned_duration_reached' },
        deps.now,
      );
      return true;
    }
    return false;
  }
  if (minutesSince(session.startedAt, nowMs) / 60 >= OPEN_ENDED_SESSION_MAX_HOURS) {
    await endSession(
      deps.store,
      session.id,
      { endedBy: null, endReason: 'force_terminated' },
      deps.now,
    );
    return true;
  }
  return false;
};

// Closes any non-host open interval whose presence has gone unseen for
// PARTICIPANT_PRESENCE_TIMEOUT_MINUTES — this is what lets end-session.ts
// ever terminate for a participant who went offline and never came back
// (they'll finalize as 'disconnected' once the session ends). Falls back
// to the interval's own joined_at when presence has never synced them at
// all yet, so a participant isn't penalized for the ordinary latency
// between joining and their first presence heartbeat. Returns the set of
// userIds closed this pass, so the caller can exclude them from host
// migration candidates in the same tick.
const reconcileStaleParticipants = async (
  deps: SweepDeps,
  session: ActiveSessionSummary,
  openIntervals: readonly PresenceIntervalRow[],
  lastSeen: ReadonlyMap<string, Date>,
  nowMs: number,
): Promise<ReadonlySet<string>> => {
  const closed = new Set<string>();
  for (const interval of openIntervals) {
    if (interval.userId === session.hostId) {
      continue;
    }
    const referenceMs = (lastSeen.get(interval.userId) ?? new Date(interval.joinedAt)).getTime();
    if ((nowMs - referenceMs) / 60_000 >= PARTICIPANT_PRESENCE_TIMEOUT_MINUTES) {
      await deps.store.closeOpenInterval(session.id, interval.userId, 'involuntary_disconnect');
      closed.add(interval.userId);
    }
  }
  return closed;
};

// Promotes whoever has the highest cumulative minutes_present in the
// session (not the earliest joiner, and not just the longest CURRENT
// interval — a participant who disconnected and rejoined still keeps
// credit for their earlier time), ties broken by whoever's current
// interval has been open longest (ARCHITECTURE.md §6). If nobody else is
// present, the session simply stays host_disconnected indefinitely — no
// separate timeout (Phase 4 decision).
const maybeMigrateHost = async (
  deps: SweepDeps,
  session: ActiveSessionSummary,
  openIntervals: readonly PresenceIntervalRow[],
  allIntervals: readonly PresenceIntervalRow[],
  lastSeen: ReadonlyMap<string, Date>,
  justReconciled: ReadonlySet<string>,
  nowMs: number,
): Promise<void> => {
  const hostReferenceMs = (
    lastSeen.get(session.hostId) ?? new Date(session.startedAt ?? nowMs)
  ).getTime();
  if ((nowMs - hostReferenceMs) / 1000 < HOST_MIGRATION_PRESENCE_TIMEOUT_SECONDS) {
    return;
  }

  const candidates = openIntervals.filter(
    (interval) => interval.userId !== session.hostId && !justReconciled.has(interval.userId),
  );
  if (candidates.length === 0) {
    return;
  }

  const promoted = candidates.reduce((best, candidate) => {
    const bestMinutes = cumulativeMinutesPresent(best.userId, allIntervals, nowMs);
    const candidateMinutes = cumulativeMinutesPresent(candidate.userId, allIntervals, nowMs);
    if (candidateMinutes !== bestMinutes) {
      return candidateMinutes > bestMinutes ? candidate : best;
    }
    return new Date(candidate.joinedAt) < new Date(best.joinedAt) ? candidate : best;
  });

  await deps.store.migrateHost(
    session.id,
    session.hostId,
    promoted.userId,
    deps.now().toISOString(),
  );
  await deps.realtime.broadcastHostMigrated(session.id);
};

// The one entry point the sweep scheduler (server.ts) calls on a fixed
// cadence (SESSION_SWEEP_INTERVAL_SECONDS). Auto-close, then stale-
// participant reconciliation, then host-migration detection, per session —
// see each helper above for why that order matters.
export const runSweep = async (deps: SweepDeps): Promise<void> => {
  const sessions = await deps.store.listActiveSessions();

  for (const session of sessions) {
    deps.realtime.track(session.id);
    const nowMs = deps.now().getTime();

    if (await maybeAutoClose(deps, session, nowMs)) {
      deps.realtime.untrack(session.id);
      continue;
    }

    const allIntervals = await deps.store.getPresenceIntervals(session.id);
    const openIntervals = allIntervals.filter((interval) => interval.leftAt === null);
    const lastSeen = deps.realtime.lastSeenAt(session.id);

    const justReconciled = await reconcileStaleParticipants(
      deps,
      session,
      openIntervals,
      lastSeen,
      nowMs,
    );
    await maybeMigrateHost(
      deps,
      session,
      openIntervals,
      allIntervals,
      lastSeen,
      justReconciled,
      nowMs,
    );
  }
};
