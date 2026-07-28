import { computeTotalMinutesPresent } from './base-points';
import type { PresenceInterval } from './types';

const interval = (joinedAt: string, leftAt: string): PresenceInterval => ({
  joinedAt: new Date(joinedAt),
  leftAt: new Date(leftAt),
  blockerReadyAt: null,
  deviceTrusted: true,
});

describe('computeTotalMinutesPresent', () => {
  it('returns 0 for no intervals', () => {
    expect(computeTotalMinutesPresent([])).toBe(0);
  });

  it('sums minutes present for a single interval', () => {
    const intervals = [interval('2026-01-01T10:00:00Z', '2026-01-01T10:45:00Z')];

    expect(computeTotalMinutesPresent(intervals)).toBe(45);
  });

  it('sums minutes across multiple non-contiguous intervals (rejoin)', () => {
    const intervals = [
      interval('2026-01-01T10:00:00Z', '2026-01-01T10:20:00Z'),
      interval('2026-01-01T10:30:00Z', '2026-01-01T11:00:00Z'),
    ];

    expect(computeTotalMinutesPresent(intervals)).toBe(50);
  });

  it('floors a partial minute rather than rounding up', () => {
    const intervals = [interval('2026-01-01T10:00:00Z', '2026-01-01T10:01:59Z')];

    expect(computeTotalMinutesPresent(intervals)).toBe(1);
  });
});
