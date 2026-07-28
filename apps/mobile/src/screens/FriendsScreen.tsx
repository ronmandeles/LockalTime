import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import {
  listFriendRequests,
  listFriends,
  respondToFriendRequest,
  searchUsers,
  sendFriendRequest,
} from '../services/api-client';
import type {
  FriendLeaderboardEntry,
  PendingFriendRequest,
  UserSearchResult,
} from '../services/api-client';
import { removeFriend } from '../services/friends-repository';
import { useAuthStore } from '../state/auth-store';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Friends leaderboard (Phase 6.5, docs/RETENTION_STRATEGY.md §4) — reached
// from Home's friendsCta link, available to every user (not role-gated,
// unlike the venue screens). Ranked by totalPoints, pre-sorted server-side
// (friends-store.ts's listFriends) — this screen renders the array as-is,
// never re-sorts. Only totalPoints and a coarse "active today" indicator
// are ever shown for a friend — never their real streak length or session
// history (the Phase 6.5 privacy decision).
type FriendsScreenProps = NativeStackScreenProps<RootStackParamList, 'Friends'>;

const MIN_SEARCH_QUERY_LENGTH = 2;

type LeaderboardState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly leaderboard: readonly FriendLeaderboardEntry[] }
  | { readonly status: 'error' };

type SearchState =
  | { readonly status: 'idle' }
  | { readonly status: 'searching' }
  | { readonly status: 'results'; readonly results: readonly UserSearchResult[] }
  | { readonly status: 'tooShort' }
  | { readonly status: 'error' };

const FriendsScreen = (_props: FriendsScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const userId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );

  const [leaderboardState, setLeaderboardState] = useState<LeaderboardState>({ status: 'loading' });
  const [incomingRequests, setIncomingRequests] = useState<readonly PendingFriendRequest[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [query, setQuery] = useState('');
  const [searchState, setSearchState] = useState<SearchState>({ status: 'idle' });
  const [sentRequestIds, setSentRequestIds] = useState<ReadonlySet<string>>(new Set());
  const [requestActionError, setRequestActionError] = useState<string | null>(null);

  const [confirmingRemoveId, setConfirmingRemoveId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLeaderboardState({ status: 'loading' });

    Promise.all([listFriends(), listFriendRequests()]).then(([friendsResult, requestsResult]) => {
      if (cancelled) {
        return;
      }
      if (!friendsResult.ok) {
        setLeaderboardState({ status: 'error' });
        return;
      }
      setLeaderboardState({ status: 'loaded', leaderboard: friendsResult.value.leaderboard });
      setIncomingRequests(requestsResult.ok ? requestsResult.value.incoming : []);
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleSearchSubmit = (): void => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_SEARCH_QUERY_LENGTH) {
      setSearchState({ status: 'tooShort' });
      return;
    }
    setSearchState({ status: 'searching' });
    searchUsers(trimmed).then((result) => {
      if (!result.ok) {
        setSearchState({ status: 'error' });
        return;
      }
      setSearchState({ status: 'results', results: result.value.results });
    });
  };

  const handleSendRequest = (recipientId: string): void => {
    setRequestActionError(null);
    sendFriendRequest(recipientId)
      .then((result) => {
        if (!result.ok) {
          setRequestActionError(t('friends.search.error'));
          return;
        }
        setSentRequestIds((ids) => new Set(ids).add(recipientId));
        if (result.value.status === 'friends') {
          setReloadToken((token) => token + 1);
        }
      })
      .catch(() => {
        setRequestActionError(t('friends.search.error'));
      });
  };

  const handleRespond = (requestId: string, accept: boolean): void => {
    setRequestActionError(null);
    respondToFriendRequest(requestId, accept)
      .then((result) => {
        if (!result.ok) {
          setRequestActionError(t('friends.requests.error'));
          return;
        }
        setReloadToken((token) => token + 1);
      })
      .catch(() => {
        setRequestActionError(t('friends.requests.error'));
      });
  };

  const handleRemove = (friendId: string): void => {
    if (userId === null) {
      return;
    }
    setRemoveError(null);
    removeFriend(userId, friendId)
      .then((result) => {
        setConfirmingRemoveId(null);
        if (!result.ok) {
          setRemoveError(t('friends.remove.error'));
          return;
        }
        setReloadToken((token) => token + 1);
      })
      .catch(() => {
        setConfirmingRemoveId(null);
        setRemoveError(t('friends.remove.error'));
      });
  };

  const relationshipLabel = (result: UserSearchResult): string | null => {
    if (result.relationship === 'requested' || sentRequestIds.has(result.id)) {
      return t('friends.search.requested');
    }
    if (result.relationship === 'friends') {
      return t('friends.search.friends');
    }
    if (result.relationship === 'incoming') {
      return t('friends.search.incoming');
    }
    return null;
  };

  return (
    <View style={styles.container} testID="friends-screen">
      <Text style={styles.title}>{t('friends.title')}</Text>

      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder={t('friends.search.placeholder')}
          placeholderTextColor="#888888"
          testID="friends-search-input"
        />
        <TouchableOpacity onPress={handleSearchSubmit} testID="friends-search-submit">
          <Text style={styles.searchSubmitLabel}>{t('friends.search.add')}</Text>
        </TouchableOpacity>
      </View>

      {searchState.status === 'tooShort' && (
        <Text style={styles.error}>{t('friends.search.tooShort')}</Text>
      )}
      {searchState.status === 'error' && <Text style={styles.error}>{t('friends.search.error')}</Text>}
      {searchState.status === 'results' && searchState.results.length === 0 && (
        <Text style={styles.body}>{t('friends.search.noResults')}</Text>
      )}
      {searchState.status === 'results' &&
        searchState.results.map((result) => {
          const label = relationshipLabel(result);
          return (
            <View key={result.id} style={styles.searchResultRow} testID={`friends-search-result-${result.id}`}>
              <Text style={styles.body}>{result.displayName}</Text>
              {label !== null ? (
                <Text style={styles.subduedLabel}>{label}</Text>
              ) : (
                <TouchableOpacity
                  onPress={() => handleSendRequest(result.id)}
                  testID={`friends-search-add-${result.id}`}
                >
                  <Text style={styles.actionLabel}>{t('friends.search.add')}</Text>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      {requestActionError !== null && <Text style={styles.error}>{requestActionError}</Text>}

      {incomingRequests.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('friends.requests.title')}</Text>
          {incomingRequests.map((incoming) => (
            <View key={incoming.id} style={styles.requestRow} testID={`friends-request-${incoming.id}`}>
              <Text style={styles.body}>{incoming.displayName}</Text>
              <View style={styles.requestActions}>
                <TouchableOpacity
                  onPress={() => handleRespond(incoming.id, true)}
                  testID={`friends-request-accept-${incoming.id}`}
                >
                  <Text style={styles.actionLabel}>{t('friends.requests.accept')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleRespond(incoming.id, false)}
                  testID={`friends-request-decline-${incoming.id}`}
                >
                  <Text style={styles.subduedLabel}>{t('friends.requests.decline')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={styles.section}>
        {leaderboardState.status === 'loading' && (
          <Text style={styles.body} testID="friends-loading">
            {t('friends.title')}
          </Text>
        )}

        {leaderboardState.status === 'error' && (
          <View>
            <Text style={styles.error} testID="friends-load-error">
              {t('friends.loadError')}
            </Text>
            <TouchableOpacity
              onPress={() => setReloadToken((token) => token + 1)}
              testID="friends-retry"
            >
              <Text style={styles.retryLabel}>{t('friends.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {leaderboardState.status === 'loaded' && leaderboardState.leaderboard.length <= 1 && (
          <Text style={styles.body}>{t('friends.emptyLeaderboard')}</Text>
        )}

        {removeError !== null && <Text style={styles.error}>{removeError}</Text>}

        {leaderboardState.status === 'loaded' &&
          leaderboardState.leaderboard.map((entry, index) => (
            <View key={entry.id} style={styles.leaderboardRow} testID={`friends-leaderboard-row-${entry.id}`}>
              <Text style={styles.rank}>{index + 1}</Text>
              <View style={styles.leaderboardInfo}>
                <Text style={styles.body}>
                  {entry.isSelf ? t('friends.you') : entry.displayName}
                </Text>
                <Text style={styles.subduedLabel}>
                  {t('friends.pointsLabel', { count: entry.totalPoints })}
                </Text>
                {entry.hadSessionToday && (
                  <Text style={styles.activeToday}>{t('friends.activeToday')}</Text>
                )}
              </View>

              {!entry.isSelf &&
                (confirmingRemoveId === entry.id ? (
                  <View style={styles.confirmRow}>
                    <TouchableOpacity
                      onPress={() => setConfirmingRemoveId(null)}
                      testID={`friends-remove-cancel-${entry.id}`}
                    >
                      <Text style={styles.subduedLabel}>{t('friends.remove.cancel')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => handleRemove(entry.id)}
                      testID={`friends-remove-confirm-${entry.id}`}
                    >
                      <Text style={styles.actionLabel}>{t('friends.remove.confirm')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    onPress={() => setConfirmingRemoveId(entry.id)}
                    testID={`friends-remove-${entry.id}`}
                  >
                    <Text style={styles.subduedLabel}>{t('friends.remove.label')}</Text>
                  </TouchableOpacity>
                ))}
            </View>
          ))}

        {confirmingRemoveId !== null && (
          <View>
            <Text style={styles.confirmTitle}>{t('friends.remove.confirmTitle')}</Text>
            <Text style={styles.body}>{t('friends.remove.confirmBody')}</Text>
          </View>
        )}
      </View>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  actionLabel: {
    ...typography.bodyStrong,
    color: '#222222',
    minHeight: sizing.minTouchTarget,
  },
  activeToday: {
    ...typography.caption,
    color: '#666666',
  },
  body: {
    ...typography.body,
    color: '#222222',
  },
  confirmRow: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  confirmTitle: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.md,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.sm,
  },
  leaderboardInfo: {
    flex: 1,
    marginStart: spacing.md,
  },
  leaderboardRow: {
    alignItems: 'center',
    borderRadius: radius.md,
    flexDirection: 'row',
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  rank: {
    ...typography.bodyStrong,
    color: '#666666',
    minWidth: sizing.minTouchTarget / 2,
  },
  requestActions: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  requestRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  retryLabel: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.sm,
  },
  searchInput: {
    ...typography.body,
    borderColor: '#CCCCCC',
    borderRadius: radius.md,
    borderWidth: 1,
    color: '#222222',
    flex: 1,
    height: sizing.inputHeight,
    paddingHorizontal: spacing.md,
  },
  searchResultRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  searchRow: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: spacing.lg,
  },
  searchSubmitLabel: {
    ...typography.bodyStrong,
    color: '#222222',
    minHeight: sizing.minTouchTarget,
  },
  section: {
    marginTop: spacing['2xl'],
  },
  sectionTitle: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  subduedLabel: {
    ...typography.caption,
    color: '#666666',
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
});

export default FriendsScreen;
