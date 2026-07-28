// Resolves "today" in a given IANA timezone as a YYYY-MM-DD string —
// en-CA is the standard locale trick for an Intl-formatted ISO date, no
// timezone library needed. Falls back to UTC for a null or
// unrecognized/garbage timezone string, mirroring apply_session_stats()'s
// own "invalid_parameter_value -> fall back to UTC" posture (Postgres
// migration 20260728160000) rather than throwing.
export const resolveLocalDate = (now: Date, timezone: string | null): string => {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: timezone ?? 'UTC' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(now);
  }
};

// The one place the Phase 6.5 privacy decision ("friends see a coarse
// active-today signal, never the raw last_session_day/current_streak
// columns") actually gets enforced: this reduces user_streaks.
// last_session_day down to a boolean, computed against THAT user's own
// timezone — never the caller's, never UTC by default.
export const hadSessionToday = (
  lastSessionDay: string | null,
  now: Date,
  timezone: string | null,
): boolean => lastSessionDay !== null && lastSessionDay === resolveLocalDate(now, timezone);
