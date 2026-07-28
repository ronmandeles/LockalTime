import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { fetchSessionHistory, HISTORY_PAGE_SIZE } from '../services/stats-repository';
import type { HistoryFilter, SessionHistoryRow } from '../services/stats-repository';
import { useAuthStore } from '../state/auth-store';
import { radius, spacing, typography } from '../theme/tokens';

// History (Screen 11), DESIGN_GUIDELINES §0: an acquisition surface — full
// design effort. Solo/Group/All filter is local screen state (matching
// every other screen's own UI-state convention here), re-querying from
// page one on every filter change. Keyset pagination (not OFFSET): each
// page asks for rows strictly older than the last row's ended_at, so the
// list stays fast at any history size — see stats-repository.ts's
// fetchSessionHistory for why.
type HistoryScreenProps = NativeStackScreenProps<RootStackParamList, 'History'>;

type LoadStatus = 'loading' | 'error' | 'ready';

// row.type is a closed union (session-repository.ts), not free-form DB
// text, so an exhaustive switch is both safe and self-documenting — no
// unchecked assertion needed the way a DB-sourced slug (HomeScreen.tsx)
// does.
const translateSessionType = (t: (key: string) => string, type: SessionHistoryRow['type']): string => {
  switch (type) {
    case 'solo':
      return t('history.type.solo');
    case 'dynamic_qr':
      return t('history.type.dynamic_qr');
    case 'static_qr':
      return t('history.type.static_qr');
  }
};

// navigation/route are unused: History has no outgoing navigation of its
// own — back is the platform gesture/button the navigator already
// provides — but the component still types its one parameter against the
// full screen-props shape, matching every other registered route.
const HistoryScreen = (_props: HistoryScreenProps): React.JSX.Element => {
  const { t, i18n } = useTranslation();
  const userId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );
  const [filter, setFilter] = useState<HistoryFilter>('all');
  const [rows, setRows] = useState<readonly SessionHistoryRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  // Bumped by handleRetry to re-run the effect below with the exact same
  // first-page-load logic, without duplicating it — the effect's own
  // [userId, filter] deps don't change on a retry, so a third dependency
  // exists solely to be incremented.
  const [reloadToken, setReloadToken] = useState(0);

  // Re-runs from page one whenever the filter changes, the user id
  // resolves, or a retry is requested — always a fresh query, never a
  // client-side re-filter of already-loaded rows, so pagination cursors
  // stay correct per filter.
  useEffect(() => {
    if (userId === null) {
      setStatus('ready');
      setRows([]);
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    setRows([]);
    setHasMore(true);

    fetchSessionHistory(userId, filter).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setStatus('error');
        return;
      }
      setRows(result.value);
      setHasMore(result.value.length === HISTORY_PAGE_SIZE);
      setStatus('ready');
    });

    return () => {
      cancelled = true;
    };
  }, [userId, filter, reloadToken]);

  const handleLoadMore = (): void => {
    // Guards against onEndReached firing repeatedly while a page is
    // already in flight, and against paging past the last real page.
    if (userId === null || isLoadingMore || !hasMore) {
      return;
    }
    const lastRow = rows[rows.length - 1];
    if (lastRow === undefined) {
      return;
    }
    setIsLoadingMore(true);
    fetchSessionHistory(userId, filter, lastRow.ended_at).then((result) => {
      setIsLoadingMore(false);
      if (!result.ok) {
        // Existing rows stay on screen; scrolling back down retries.
        return;
      }
      setRows((previous) => [...previous, ...result.value]);
      setHasMore(result.value.length === HISTORY_PAGE_SIZE);
    });
  };

  const handleRetry = (): void => {
    setReloadToken((token) => token + 1);
  };

  const filters: readonly HistoryFilter[] = ['all', 'solo', 'group'];

  return (
    <View style={styles.container} testID="history-screen">
      <Text style={styles.title}>{t('history.title')}</Text>

      <View style={styles.filterRow}>
        {filters.map((option) => (
          <TouchableOpacity
            key={option}
            onPress={() => setFilter(option)}
            style={[styles.filterChip, filter === option && styles.filterChipSelected]}
            testID={`history-filter-${option}`}
          >
            <Text
              style={[styles.filterChipLabel, filter === option && styles.filterChipLabelSelected]}
            >
              {t(`history.filters.${option}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {status === 'loading' && (
        <ActivityIndicator testID="history-loading" style={styles.centered} />
      )}

      {status === 'error' && (
        <View style={styles.centered}>
          <Text style={styles.emptyText}>{t('history.loadError')}</Text>
          <TouchableOpacity onPress={handleRetry} style={styles.retryButton} testID="history-retry">
            <Text style={styles.retryButtonLabel}>{t('history.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {status === 'ready' && rows.length === 0 && (
        <View style={styles.centered} testID="history-empty">
          <Text style={styles.emptyText}>{t(`history.empty.${filter}`)}</Text>
        </View>
      )}

      {status === 'ready' && rows.length > 0 && (
        <FlatList
          data={rows}
          keyExtractor={(row) => row.id}
          onEndReached={handleLoadMore}
          onEndReachedThreshold={0.5}
          testID="history-list"
          ListFooterComponent={
            isLoadingMore ? <ActivityIndicator testID="history-loading-more" /> : null
          }
          renderItem={({ item }) => (
            <View style={styles.row} testID="history-row">
              <View style={styles.rowHeader}>
                <Text style={styles.rowDate}>
                  {new Date(item.ended_at).toLocaleDateString(i18n.language)}
                </Text>
                <Text style={styles.rowPoints}>
                  {t('history.pointsEarned', { count: item.points_earned })}
                </Text>
              </View>
              <Text style={styles.rowType}>{translateSessionType(t, item.type)}</Text>
              <Text style={styles.rowMinutes}>
                {t('history.minutesPresent', { count: item.total_minutes_present })}
              </Text>
              {(item.group_bonus_earned || item.completion_bonus_earned) && (
                <View style={styles.chipRow}>
                  {item.group_bonus_earned && (
                    <View style={styles.chip}>
                      <Text style={styles.chipLabel}>{t('history.groupBonusChip')}</Text>
                    </View>
                  )}
                  {item.completion_bonus_earned && (
                    <View style={styles.chip}>
                      <Text style={styles.chipLabel}>{t('history.completionBonusChip')}</Text>
                    </View>
                  )}
                </View>
              )}
            </View>
          )}
        />
      )}
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  centered: {
    alignItems: 'center',
    marginTop: spacing['2xl'],
  },
  chip: {
    backgroundColor: '#EFEFEF',
    borderRadius: radius.sm,
    marginEnd: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipLabel: {
    ...typography.caption,
    color: '#444444',
  },
  chipRow: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing['2xl'],
  },
  emptyText: {
    ...typography.body,
    color: '#666666',
    textAlign: 'center',
  },
  filterChip: {
    borderColor: '#CCCCCC',
    borderRadius: radius.full,
    borderWidth: 1,
    marginEnd: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  filterChipLabel: {
    ...typography.caption,
    color: '#444444',
  },
  filterChipLabelSelected: {
    color: '#FFFFFF',
  },
  filterChipSelected: {
    backgroundColor: '#222222',
    borderColor: '#222222',
  },
  filterRow: {
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  retryButton: {
    borderColor: '#222222',
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  retryButtonLabel: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  row: {
    borderBottomColor: '#EFEFEF',
    borderBottomWidth: 1,
    paddingVertical: spacing.md,
  },
  rowDate: {
    ...typography.caption,
    color: '#666666',
  },
  rowHeader: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  rowMinutes: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  rowPoints: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  rowType: {
    ...typography.body,
    color: '#222222',
    marginTop: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: '#222222',
    marginBottom: spacing.lg,
  },
});

export default HistoryScreen;
