// Shared types for the points/bonus engine (ARCHITECTURE.md §7,
// DATABASE.md "Bonus Computation"). Pure data — no logic lives here.

// Mirrors session_participants.exit_reason (DATABASE.md) once Phase 4's
// migration adds 'disconnected' alongside the existing 'completed' /
// 'emergency_exit' values.
export type ExitReason = 'completed' | 'emergency_exit' | 'disconnected';

// One closed row of session_presence_intervals. The caller (the session-end
// endpoint, or the emergency-exit leave handler) is responsible for closing
// every interval before building this — this module never reasons about an
// "open" (still-present) interval.
export interface PresenceInterval {
  readonly joinedAt: Date;
  readonly leftAt: Date;
  // Null if the participant's device never confirmed the native blocker
  // actually started. Such an interval still counts for base points, but
  // never contributes to the group bonus's concurrent-count threshold
  // (ARCHITECTURE.md §7's Sybil-resistance gate, §8 item 9).
  readonly blockerReadyAt: Date | null;
}

export interface ParticipantSummary {
  readonly userId: string;
  // Every presence interval this user had in the session, in any order —
  // more than one means they disconnected and rejoined at least once.
  readonly intervals: readonly PresenceInterval[];
  readonly exitReason: ExitReason;
}

export interface SessionTiming {
  readonly startedAt: Date;
  readonly endedAt: Date;
}

export interface ParticipantReward {
  readonly userId: string;
  readonly totalMinutesPresent: number;
  readonly groupBonusEarned: boolean;
  readonly completionBonusEarned: boolean;
  readonly pointsEarned: number;
}
