import type { PresenceInterval } from './types';

// Money-equivalent logic (ARCHITECTURE.md §3/§7): base points are always
// linear in minutes actually present, for every exit type and duration
// mode — "actual vs planned" resolved to mean nothing more than "you get
// points for the minutes you were actually there" (§7, §11). Floors a
// partial minute rather than rounding up.
export const computeTotalMinutesPresent = (intervals: readonly PresenceInterval[]): number => {
  const totalMs = intervals.reduce(
    (sum, interval) => sum + (interval.leftAt.getTime() - interval.joinedAt.getTime()),
    0,
  );
  return Math.floor(totalMs / 60_000);
};
