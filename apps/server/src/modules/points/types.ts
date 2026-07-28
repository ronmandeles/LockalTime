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
  // Phase 6 tasks 8-9: false only when device attestation reported a
  // no-integrity-signal verdict AND enforcement was enabled at write time
  // (the gating already happened once, upstream, when this value was
  // written — see attestation/trust-tier.ts's applyEnforcementPolicy) —
  // with enforcement off (the shipping default), this is always true, so
  // this column changes nothing yet. Same "still counts for base points,
  // never for the group bonus" shape as blockerReadyAt.
  readonly deviceTrusted: boolean;
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
  // basePoints + groupBonusPoints + completionBonusPoints === pointsEarned,
  // always — the breakdown exists for rewards_history's separate rows and
  // Screen 10's "bonuses broken out separately" receipt (ARCHITECTURE.md
  // §9), not as an independent computation from pointsEarned.
  readonly basePoints: number;
  readonly groupBonusEarned: boolean;
  readonly groupBonusPoints: number;
  readonly completionBonusEarned: boolean;
  readonly completionBonusPoints: number;
  readonly pointsEarned: number;
}
