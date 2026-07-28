import type { SupabaseClient } from '@supabase/supabase-js';

import { ApiError } from '../../middleware/api-error';
import { hadSessionToday } from './local-date';

export type RelationshipState = 'none' | 'requested' | 'incoming' | 'friends';

export interface UserSearchResult {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly relationship: RelationshipState;
}

export interface PendingFriendRequest {
  readonly id: string;
  readonly userId: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly createdAt: string;
}

export interface PendingFriendRequestsList {
  readonly incoming: ReadonlyArray<PendingFriendRequest>;
  readonly outgoing: ReadonlyArray<PendingFriendRequest>;
}

export type SendFriendRequestOutcome =
  | 'requested'
  | 'already_requested'
  | 'already_friends'
  | 'invalid_recipient'
  | 'friends';

export type RespondToFriendRequestOutcome = 'accepted' | 'declined' | 'not_found';

export interface FriendLeaderboardEntry {
  readonly id: string;
  readonly username: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly totalPoints: number;
  readonly hadSessionToday: boolean;
  readonly isSelf: boolean;
}

interface PublicUserRow {
  id: string;
  username: string;
  display_name: string;
  avatar_url: string | null;
}

const toSearchResult = (row: PublicUserRow, relationship: RelationshipState): UserSearchResult => ({
  id: row.id,
  username: row.username,
  displayName: row.display_name,
  avatarUrl: row.avatar_url,
  relationship,
});

// Its own bounded-context store, same separation as venues-store.ts/
// notifications-store.ts — friend requests/friendships aren't session or
// venue data. No unit test here: this codebase's convention (sessions-
// store.ts, users-store.ts) is that a createSupabase*Store adapter is
// proven by the real integration suite against the live local stack, not
// by mocking the Supabase query-builder chain — see
// apps/server/integration/friends.integration.test.ts.
export interface FriendsStore {
  searchUsers(callerId: string, query: string): Promise<ReadonlyArray<UserSearchResult>>;
  listPendingRequests(userId: string): Promise<PendingFriendRequestsList>;
  sendFriendRequest(requesterId: string, recipientId: string): Promise<SendFriendRequestOutcome>;
  respondToFriendRequest(
    recipientId: string,
    requestId: string,
    accept: boolean,
  ): Promise<RespondToFriendRequestOutcome>;
  // The leaderboard: caller included (isSelf: true), pre-sorted by
  // totalPoints descending — the natural ranked shape, computed once
  // server-side rather than making the client re-sort/re-derive its own
  // rank from an unordered list. Only totalPoints and a coarse
  // hadSessionToday boolean ever cross the boundary — never
  // current_streak, daily time-series data, or anything else user_stats/
  // user_streaks hold (the Phase 6.5 privacy decision).
  listFriends(userId: string): Promise<ReadonlyArray<FriendLeaderboardEntry>>;
}

const USER_SEARCH_COLUMNS = 'id, username, display_name, avatar_url';

export const createSupabaseFriendsStore = (client: SupabaseClient): FriendsStore => ({
  async searchUsers(callerId, query) {
    const { data: userRows, error: searchError } = await client
      .from('users')
      .select(USER_SEARCH_COLUMNS)
      .ilike('username', `%${query}%`)
      .neq('id', callerId)
      .limit(20);

    if (searchError !== null) {
      throw new ApiError(500, 'user_search_failed', searchError.message);
    }
    const results = (userRows ?? []) as PublicUserRow[];
    if (results.length === 0) {
      return [];
    }
    const resultIds = results.map((row) => row.id);

    const { data: friendshipRows, error: friendshipError } = await client
      .from('friendships')
      .select('user_id_a, user_id_b')
      .or(
        `and(user_id_a.eq.${callerId},user_id_b.in.(${resultIds.join(
          ',',
        )})),and(user_id_b.eq.${callerId},user_id_a.in.(${resultIds.join(',')}))`,
      );
    if (friendshipError !== null) {
      throw new ApiError(500, 'user_search_failed', friendshipError.message);
    }
    const friendIds = new Set<string>(
      ((friendshipRows ?? []) as Array<{ user_id_a: string; user_id_b: string }>).map((row) =>
        row.user_id_a === callerId ? row.user_id_b : row.user_id_a,
      ),
    );

    const { data: requestRows, error: requestError } = await client
      .from('friend_requests')
      .select('requester_id, recipient_id')
      .or(
        `and(requester_id.eq.${callerId},recipient_id.in.(${resultIds.join(
          ',',
        )})),and(recipient_id.eq.${callerId},requester_id.in.(${resultIds.join(',')}))`,
      );
    if (requestError !== null) {
      throw new ApiError(500, 'user_search_failed', requestError.message);
    }
    const outgoingIds = new Set<string>();
    const incomingIds = new Set<string>();
    for (const row of (requestRows ?? []) as Array<{
      requester_id: string;
      recipient_id: string;
    }>) {
      if (row.requester_id === callerId) {
        outgoingIds.add(row.recipient_id);
      } else {
        incomingIds.add(row.requester_id);
      }
    }

    return results.map((row) => {
      const relationship: RelationshipState = friendIds.has(row.id)
        ? 'friends'
        : outgoingIds.has(row.id)
        ? 'requested'
        : incomingIds.has(row.id)
        ? 'incoming'
        : 'none';
      return toSearchResult(row, relationship);
    });
  },

  async listPendingRequests(userId) {
    const { data: requestRows, error: requestError } = await client
      .from('friend_requests')
      .select('id, requester_id, recipient_id, created_at')
      .or(`requester_id.eq.${userId},recipient_id.eq.${userId}`);
    if (requestError !== null) {
      throw new ApiError(500, 'friend_requests_list_failed', requestError.message);
    }
    const rows = (requestRows ?? []) as Array<{
      id: string;
      requester_id: string;
      recipient_id: string;
      created_at: string;
    }>;
    if (rows.length === 0) {
      return { incoming: [], outgoing: [] };
    }

    const otherPartyIds = rows.map((row) =>
      row.requester_id === userId ? row.recipient_id : row.requester_id,
    );
    const { data: userRows, error: usersError } = await client
      .from('users')
      .select(USER_SEARCH_COLUMNS)
      .in('id', otherPartyIds);
    if (usersError !== null) {
      throw new ApiError(500, 'friend_requests_list_failed', usersError.message);
    }
    const userById = new Map<string, PublicUserRow>(
      ((userRows ?? []) as PublicUserRow[]).map((row) => [row.id, row]),
    );

    const incoming: PendingFriendRequest[] = [];
    const outgoing: PendingFriendRequest[] = [];
    for (const row of rows) {
      const isIncoming = row.recipient_id === userId;
      const otherPartyId = isIncoming ? row.requester_id : row.recipient_id;
      const otherParty = userById.get(otherPartyId);
      if (otherParty === undefined) {
        continue;
      }
      const entry: PendingFriendRequest = {
        id: row.id,
        userId: otherParty.id,
        username: otherParty.username,
        displayName: otherParty.display_name,
        avatarUrl: otherParty.avatar_url,
        createdAt: row.created_at,
      };
      if (isIncoming) {
        incoming.push(entry);
      } else {
        outgoing.push(entry);
      }
    }
    return { incoming, outgoing };
  },

  async sendFriendRequest(requesterId, recipientId) {
    const { data, error } = await client.rpc('send_friend_request', {
      p_requester_id: requesterId,
      p_recipient_id: recipientId,
    });
    if (error !== null) {
      throw new ApiError(500, 'friend_request_send_failed', error.message);
    }
    return data as SendFriendRequestOutcome;
  },

  async respondToFriendRequest(recipientId, requestId, accept) {
    const { data, error } = await client.rpc('respond_to_friend_request', {
      p_recipient_id: recipientId,
      p_request_id: requestId,
      p_accept: accept,
    });
    if (error !== null) {
      throw new ApiError(500, 'friend_request_respond_failed', error.message);
    }
    return data as RespondToFriendRequestOutcome;
  },

  async listFriends(userId) {
    const { data: friendshipRows, error: friendshipError } = await client
      .from('friendships')
      .select('user_id_a, user_id_b')
      .or(`user_id_a.eq.${userId},user_id_b.eq.${userId}`);
    if (friendshipError !== null) {
      throw new ApiError(500, 'friends_list_failed', friendshipError.message);
    }
    const friendIds = (
      (friendshipRows ?? []) as Array<{ user_id_a: string; user_id_b: string }>
    ).map((row) => (row.user_id_a === userId ? row.user_id_b : row.user_id_a));
    const allIds = [userId, ...friendIds];

    const [usersResult, statsResult, streaksResult] = await Promise.all([
      client
        .from('users')
        .select('id, username, display_name, avatar_url, timezone')
        .in('id', allIds),
      client.from('user_stats').select('user_id, total_points').in('user_id', allIds),
      client.from('user_streaks').select('user_id, last_session_day').in('user_id', allIds),
    ]);
    if (usersResult.error !== null) {
      throw new ApiError(500, 'friends_list_failed', usersResult.error.message);
    }
    if (statsResult.error !== null) {
      throw new ApiError(500, 'friends_list_failed', statsResult.error.message);
    }
    if (streaksResult.error !== null) {
      throw new ApiError(500, 'friends_list_failed', streaksResult.error.message);
    }

    const usersById = new Map<
      string,
      { username: string; display_name: string; avatar_url: string | null; timezone: string | null }
    >(
      (
        usersResult.data as Array<{
          id: string;
          username: string;
          display_name: string;
          avatar_url: string | null;
          timezone: string | null;
        }>
      ).map((row) => [row.id, row]),
    );
    const pointsById = new Map<string, number>(
      (statsResult.data as Array<{ user_id: string; total_points: number }>).map((row) => [
        row.user_id,
        row.total_points,
      ]),
    );
    const lastSessionDayById = new Map<string, string | null>(
      (streaksResult.data as Array<{ user_id: string; last_session_day: string | null }>).map(
        (row) => [row.user_id, row.last_session_day],
      ),
    );

    const now = new Date();
    const entries: FriendLeaderboardEntry[] = allIds.flatMap((id) => {
      const user = usersById.get(id);
      if (user === undefined) {
        return [];
      }
      return [
        {
          id,
          username: user.username,
          displayName: user.display_name,
          avatarUrl: user.avatar_url,
          totalPoints: pointsById.get(id) ?? 0,
          hadSessionToday: hadSessionToday(lastSessionDayById.get(id) ?? null, now, user.timezone),
          isSelf: id === userId,
        },
      ];
    });

    return entries.sort((a, b) => b.totalPoints - a.totalPoints);
  },
});
