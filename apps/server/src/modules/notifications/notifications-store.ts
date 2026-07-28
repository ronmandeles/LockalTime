import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../middleware/api-error';
import type { NotificationPlatform } from './notification-sender';

export interface NotificationTarget {
  readonly userId: string;
  readonly platform: NotificationPlatform;
  readonly token: string;
  readonly locale: string | null;
}

// Its own bounded-context store rather than folded into the already-large
// SessionsStore — device tokens and streak-risk claiming aren't session
// data, matching the separation already established for
// users-store.ts/venues-store.ts (Phase 6). No unit test here: this
// codebase's convention (sessions-store.ts, users-store.ts) is that a
// createSupabase*Store adapter is proven by the real integration suite
// against the live local stack, not by mocking the Supabase query-builder
// chain.
export interface NotificationsStore {
  claimStreakRiskUsers(asOf: string, windowHours: number): Promise<ReadonlyArray<string>>;
  getNotificationTargets(
    userIds: ReadonlyArray<string>,
  ): Promise<ReadonlyArray<NotificationTarget>>;
}

export const createSupabaseNotificationsStore = (client: SupabaseClient): NotificationsStore => ({
  async claimStreakRiskUsers(asOf, windowHours) {
    const { data, error } = await client.rpc('claim_streak_risk_notifications', {
      p_now: asOf,
      p_window_hours: windowHours,
    });

    if (error !== null) {
      throw new ApiError(500, 'streak_risk_claim_failed', error.message);
    }
    return ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id);
  },

  async getNotificationTargets(userIds) {
    if (userIds.length === 0) {
      return [];
    }
    const ids = [...userIds];

    // Two round trips rather than a PostgREST embedded join: this is a
    // low-volume batch job (a handful of claimed users per tick), and
    // keeping both queries as the same plain select().in() shape already
    // used throughout this codebase avoids relying on FK-relationship
    // embedding this codebase has never exercised elsewhere.
    const [tokensResult, usersResult] = await Promise.all([
      client.from('device_tokens').select('user_id, platform, token').in('user_id', ids),
      client.from('users').select('id, locale').in('id', ids),
    ]);

    if (tokensResult.error !== null) {
      throw new ApiError(500, 'notification_targets_lookup_failed', tokensResult.error.message);
    }
    if (usersResult.error !== null) {
      throw new ApiError(500, 'notification_targets_lookup_failed', usersResult.error.message);
    }

    const localeByUserId = new Map<string, string | null>(
      (usersResult.data as Array<{ id: string; locale: string | null }>).map((row) => [
        row.id,
        row.locale,
      ]),
    );

    return (tokensResult.data as Array<{ user_id: string; platform: string; token: string }>).map(
      (row) => ({
        userId: row.user_id,
        platform: row.platform as NotificationPlatform,
        token: row.token,
        locale: localeByUserId.get(row.user_id) ?? null,
      }),
    );
  },
});
