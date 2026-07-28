import AsyncStorage from '@react-native-async-storage/async-storage';
import { getTimeZone } from 'react-native-localize';

import { getSupabaseClient } from './supabase-client';

// Phase 5: reports the device's IANA timezone to users.timezone so the
// server can bucket a finalized session into the participant's LOCAL day
// rather than UTC (apps/server's apply_session_stats()) — see
// docs/DATABASE.md's "Stats/Streak/Milestone Accumulation" section.
// Display/bucketing data, not money-equivalent (CLAUDE.md's Money-
// Equivalent Logic Rule), so a direct RLS-scoped client write is
// appropriate — same posture as display_name/avatar_url.

// Renaming this key would silently orphan the cached value, causing every
// app start to re-write an unchanged timezone — pinned by test on purpose.
export const REPORTED_TIMEZONE_STORAGE_KEY = '@lockal-time/reported-timezone';

// Called once per authenticated session (App.tsx, on the auth gate
// transitioning to authenticated) — fire-and-forget, fail-open throughout
// (same posture as active-session-store.ts): any failure here just means
// the server keeps bucketing this user's stats by UTC until the next
// successful report, never blocks a user-facing flow.
export const reportTimezoneIfChanged = async (userId: string): Promise<void> => {
  try {
    const deviceTimezone = getTimeZone();

    let lastReported: string | null = null;
    try {
      lastReported = await AsyncStorage.getItem(REPORTED_TIMEZONE_STORAGE_KEY);
    } catch {
      // Fail open — worst case, one unnecessary write below.
    }
    if (lastReported === deviceTimezone) {
      return;
    }

    const { error } = await getSupabaseClient()
      .from('users')
      .update({ timezone: deviceTimezone })
      .eq('id', userId);
    if (error !== null) {
      return; // Fail open — see header comment; next call retries.
    }

    try {
      await AsyncStorage.setItem(REPORTED_TIMEZONE_STORAGE_KEY, deviceTimezone);
    } catch {
      // Fail open — the write to `users` already succeeded; a failure only
      // here means the next call redundantly re-writes the same value.
    }
  } catch {
    // Outer fail-open net: this function must never reject, so callers can
    // safely fire-and-forget it (App.tsx) with no .catch() of their own —
    // an unexpected failure (e.g. the native localize module not linked)
    // is a best-effort side effect failing, never something that should
    // propagate into the auth bootstrap flow.
  }
};
