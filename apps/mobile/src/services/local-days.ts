// Pure date arithmetic for the Stats screen's 7-day chart — kept separate
// from StatsScreen.tsx so it's independently testable without rendering
// anything, and injectable-clock (testing-standards skill) rather than
// reading the real Date at test time.

const toLocalDateString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

export type SevenLocalDays = readonly [string, string, string, string, string, string, string];

// Ascending, ending today, all in DEVICE-local time — matching the server
// side's `users.timezone` bucketing (apply_session_stats(), Phase 5) so a
// day here and a day in `user_stats_daily` mean the same wall-clock date.
// Returns a genuine 7-tuple (not `string[]`) so every caller gets
// compile-time-guaranteed defined access at each index, per
// noUncheckedIndexedAccess-style discipline — no runtime-checked
// `days[0] ?? ...` needed anywhere this is consumed.
export const getLastSevenLocalDays = (now: () => Date = () => new Date()): SevenLocalDays => {
  const today = now();
  const dayAt = (daysAgo: number): string =>
    toLocalDateString(new Date(today.getFullYear(), today.getMonth(), today.getDate() - daysAgo));
  return [dayAt(6), dayAt(5), dayAt(4), dayAt(3), dayAt(2), dayAt(1), dayAt(0)];
};
