import { getLastSevenLocalDays } from './local-days';

describe('getLastSevenLocalDays', () => {
  it('returns 7 ascending local dates ending today', () => {
    const days = getLastSevenLocalDays(() => new Date(2026, 7, 15)); // Aug 15, 2026 (local)

    expect(days).toEqual([
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
    ]);
  });

  it('crosses a month boundary correctly', () => {
    const days = getLastSevenLocalDays(() => new Date(2026, 8, 2)); // Sep 2, 2026 (local)

    expect(days).toEqual([
      '2026-08-27',
      '2026-08-28',
      '2026-08-29',
      '2026-08-30',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02',
    ]);
  });

  it('crosses a year boundary correctly', () => {
    const days = getLastSevenLocalDays(() => new Date(2027, 0, 2)); // Jan 2, 2027 (local)

    expect(days).toEqual([
      '2026-12-27',
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });

  it('uses device-LOCAL date components, not UTC', () => {
    // 23:30 local, deliberately chosen so a UTC-based implementation
    // (using getUTCDate() etc.) would compute a different day depending on
    // the test machine's own offset -- this only passes if the function
    // consistently uses the local getters (getFullYear/getMonth/getDate).
    const days = getLastSevenLocalDays(() => new Date(2026, 7, 15, 23, 30));

    expect(days[6]).toBe('2026-08-15');
  });
});
