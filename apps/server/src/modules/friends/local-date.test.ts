import { hadSessionToday, resolveLocalDate } from './local-date';

describe('resolveLocalDate', () => {
  it("resolves the date in the given IANA timezone, not UTC's", () => {
    // 2026-08-01T23:30:00Z is already 2026-08-02 in Asia/Jerusalem (UTC+3).
    const now = new Date('2026-08-01T23:30:00.000Z');
    expect(resolveLocalDate(now, 'Asia/Jerusalem')).toBe('2026-08-02');
    expect(resolveLocalDate(now, 'UTC')).toBe('2026-08-01');
  });

  it('falls back to UTC when the timezone is null (never reported)', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(resolveLocalDate(now, null)).toBe('2026-08-01');
  });

  it('falls back to UTC for an unrecognized/garbage timezone string, mirroring apply_session_stats()', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(resolveLocalDate(now, 'Not/A_Real_Zone')).toBe('2026-08-01');
  });
});

describe('hadSessionToday', () => {
  it('is true when last_session_day equals the resolved local date', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(hadSessionToday('2026-08-01', now, 'UTC')).toBe(true);
  });

  it('is false when last_session_day is a different day', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(hadSessionToday('2026-07-31', now, 'UTC')).toBe(false);
  });

  it('is false when last_session_day is null (never had a session)', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    expect(hadSessionToday(null, now, 'UTC')).toBe(false);
  });

  it("is computed against the friend's OWN timezone, not the caller's or UTC", () => {
    // 22:30 UTC on the 1st is already the 2nd in Jerusalem (UTC+3) —
    // a friend whose last session was locally "today" for them.
    const now = new Date('2026-08-01T22:30:00.000Z');
    expect(hadSessionToday('2026-08-02', now, 'Asia/Jerusalem')).toBe(true);
    expect(hadSessionToday('2026-08-01', now, 'Asia/Jerusalem')).toBe(false);
  });
});
