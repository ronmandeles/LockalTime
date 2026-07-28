import { computeCompletionBonusEligibility } from './completion-bonus';
import type { ParticipantSummary, PresenceInterval, SessionTiming } from './types';

const START = new Date('2026-01-01T10:00:00Z');
const addMinutes = (date: Date, n: number): Date => new Date(date.getTime() + n * 60_000);
const addSeconds = (date: Date, n: number): Date => new Date(date.getTime() + n * 1000);

const timing = (durationMinutes: number): SessionTiming => ({
  startedAt: START,
  endedAt: addMinutes(START, durationMinutes),
});

const wholeSessionInterval = (
  durationMinutes: number,
  joinOffsetSeconds = 0,
): PresenceInterval => ({
  joinedAt: addSeconds(START, joinOffsetSeconds),
  leftAt: addMinutes(START, durationMinutes),
  blockerReadyAt: addSeconds(START, joinOffsetSeconds),
  deviceTrusted: true,
});

const participant = (
  userId: string,
  intervals: readonly PresenceInterval[],
  exitReason: ParticipantSummary['exitReason'] = 'completed',
): ParticipantSummary => ({ userId, intervals, exitReason });

describe('computeCompletionBonusEligibility', () => {
  it('qualifies a participant present from start to end of a >= 60 minute session', () => {
    const p = participant('a', [wholeSessionInterval(90)]);

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set(['a']));
  });

  it('qualifies a session of exactly 60 minutes (boundary is inclusive)', () => {
    const p = participant('a', [wholeSessionInterval(60)]);

    expect(computeCompletionBonusEligibility([p], timing(60))).toEqual(new Set(['a']));
  });

  it('disqualifies every participant when the session ran under 60 minutes', () => {
    const p = participant('a', [wholeSessionInterval(59)]);

    expect(computeCompletionBonusEligibility([p], timing(59))).toEqual(new Set());
  });

  it('qualifies a join within the 60-second tolerance of started_at', () => {
    const p = participant('a', [wholeSessionInterval(90, 60)]);

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set(['a']));
  });

  it('disqualifies a join beyond the 60-second tolerance of started_at', () => {
    const p = participant('a', [wholeSessionInterval(90, 61)]);

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set());
  });

  it('disqualifies a participant with more than one presence interval (any gap)', () => {
    const p = participant('a', [
      {
        joinedAt: START,
        leftAt: addMinutes(START, 30),
        blockerReadyAt: START,
        deviceTrusted: true,
      },
      {
        joinedAt: addMinutes(START, 31),
        leftAt: addMinutes(START, 90),
        blockerReadyAt: addMinutes(START, 31),
        deviceTrusted: true,
      },
    ]);

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set());
  });

  it('disqualifies a participant who left before the session actually ended', () => {
    const p = participant('a', [
      {
        joinedAt: START,
        leftAt: addMinutes(START, 70),
        blockerReadyAt: START,
        deviceTrusted: true,
      },
    ]);

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set());
  });

  it('forfeits the bonus entirely for an emergency-exit participant regardless of timing', () => {
    const p = participant('a', [wholeSessionInterval(90)], 'emergency_exit');

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set());
  });

  it('forfeits the bonus entirely for a disconnected participant regardless of timing', () => {
    const p = participant('a', [wholeSessionInterval(90)], 'disconnected');

    expect(computeCompletionBonusEligibility([p], timing(90))).toEqual(new Set());
  });
});
