import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales, getTimeZone } from 'react-native-localize';

import { resolveDeviceLocale } from '../i18n/resolve-device-locale';
import { pushRegistration } from './push-registration';
import { getSupabaseClient } from './supabase-client';

// Phase 6: the client's first-ever read of its own role. Mirrors
// stats-repository.ts's RepositoryResult convention (a direct, RLS-
// protected read — never a write, never recomputed — of a value that's
// display/UI-gating only, not money-equivalent).
export type UserRole = 'user' | 'verified_host' | 'admin';

export interface UserProfileRow {
  readonly role: UserRole;
}

export interface ProfileFailure {
  readonly message: string;
}

export type ProfileResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: ProfileFailure };

// maybeSingle, not single: the signup trigger creates this row
// synchronously, but a null result is still the correct "nothing to gate
// on yet" state rather than an error, same posture as
// stats-repository.ts's fetchUserStats for a brand-new user.
export const fetchUserProfile = async (
  userId: string,
): Promise<ProfileResult<UserProfileRow | null>> => {
  const { data, error } = await getSupabaseClient()
    .from('users')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (error !== null) {
    return { ok: false, error: { message: error.message } };
  }
  return { ok: true, value: data as unknown as UserProfileRow | null };
};

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

// Phase 5.5: reports the app's resolved locale (the same resolution
// init-i18n.ts uses for the app's own UI — resolveDeviceLocale(getLocales()))
// to users.locale, so server-composed notifications (the streak-risk push)
// can be localized. Display data, not money-equivalent — same posture as
// timezone, same shape as reportTimezoneIfChanged above.
export const REPORTED_LOCALE_STORAGE_KEY = '@lockal-time/reported-locale';

export const reportLocaleIfChanged = async (userId: string): Promise<void> => {
  try {
    const deviceLocale = resolveDeviceLocale(getLocales());

    let lastReported: string | null = null;
    try {
      lastReported = await AsyncStorage.getItem(REPORTED_LOCALE_STORAGE_KEY);
    } catch {
      // Fail open — worst case, one unnecessary write below.
    }
    if (lastReported === deviceLocale) {
      return;
    }

    const { error } = await getSupabaseClient()
      .from('users')
      .update({ locale: deviceLocale })
      .eq('id', userId);
    if (error !== null) {
      return; // Fail open — see header comment; next call retries.
    }

    try {
      await AsyncStorage.setItem(REPORTED_LOCALE_STORAGE_KEY, deviceLocale);
    } catch {
      // Fail open — the write to `users` already succeeded; a failure only
      // here means the next call redundantly re-writes the same value.
    }
  } catch {
    // Outer fail-open net — see reportTimezoneIfChanged's header comment.
  }
};

// Phase 5.5: registers this device's push token directly (RLS own-rows-
// only, not money-equivalent — same posture as timezone/locale). One row
// per (user_id, platform): the upsert is what makes a reinstall replace
// the old token instead of accumulating a duplicate (owner decision, see
// docs/DATABASE.md's device_tokens section). In practice a no-op today —
// pushRegistration.getToken() never yields a real token until a real
// FCM/APNs SDK is linked (push-registration.ts) — honest, not faked.
export const REPORTED_PUSH_TOKEN_STORAGE_KEY = '@lockal-time/reported-push-token';

// Phase 7 (Release Prep): records the first time this user's device saw
// them proceed past the ToS/Privacy Policy disclosure on AuthScreen — a
// direct client write, not a Node endpoint, same posture as timezone/locale
// above (not money-equivalent, not a security boundary). Conditioned on
// `.is('tos_accepted_at', null)` rather than an unconditional overwrite:
// once recorded, the acceptance timestamp must never be silently bumped by
// a later sign-in. The AsyncStorage cache only saves a redundant no-op
// network call on every subsequent session — correctness comes from the
// database condition, not the cache.
export const ACCEPTED_TOS_STORAGE_KEY = '@lockal-time/accepted-tos';

export const acceptTosIfNeeded = async (userId: string): Promise<void> => {
  try {
    let alreadyAccepted: string | null = null;
    try {
      alreadyAccepted = await AsyncStorage.getItem(ACCEPTED_TOS_STORAGE_KEY);
    } catch {
      // Fail open — worst case, one unnecessary (still-conditional) write below.
    }
    if (alreadyAccepted === 'true') {
      return;
    }

    const { error } = await getSupabaseClient()
      .from('users')
      .update({ tos_accepted_at: new Date().toISOString() })
      .eq('id', userId)
      .is('tos_accepted_at', null);
    if (error !== null) {
      return; // Fail open — see header comment; next call retries.
    }

    try {
      await AsyncStorage.setItem(ACCEPTED_TOS_STORAGE_KEY, 'true');
    } catch {
      // Fail open — the write already succeeded (or was already a no-op);
      // a failure only here means the next call redundantly re-checks.
    }
  } catch {
    // Outer fail-open net — see reportTimezoneIfChanged's header comment.
  }
};

export const registerPushTokenIfChanged = async (userId: string): Promise<void> => {
  try {
    const result = await pushRegistration.getToken();
    if (result.status !== 'granted') {
      return;
    }

    let lastReported: string | null = null;
    try {
      lastReported = await AsyncStorage.getItem(REPORTED_PUSH_TOKEN_STORAGE_KEY);
    } catch {
      // Fail open — worst case, one unnecessary write below.
    }
    if (lastReported === result.token) {
      return;
    }

    const { error } = await getSupabaseClient()
      .from('device_tokens')
      .upsert(
        { user_id: userId, platform: result.platform, token: result.token },
        { onConflict: 'user_id,platform' },
      );
    if (error !== null) {
      return; // Fail open — see header comment; next call retries.
    }

    try {
      await AsyncStorage.setItem(REPORTED_PUSH_TOKEN_STORAGE_KEY, result.token);
    } catch {
      // Fail open — the write already succeeded; a failure only here means
      // the next call redundantly re-writes the same value.
    }
  } catch {
    // Outer fail-open net — see reportTimezoneIfChanged's header comment.
  }
};
