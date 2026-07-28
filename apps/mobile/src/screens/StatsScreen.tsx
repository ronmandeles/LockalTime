import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { translateMilestoneName } from '../i18n/translate-milestone-name';
import type { RootStackParamList } from '../navigation/types';
import { getLastSevenLocalDays } from '../services/local-days';
import {
  fetchDailyStats,
  fetchMilestoneProgress,
  fetchUserStats,
  fetchUserStreak,
} from '../services/stats-repository';
import type {
  MilestoneProgress,
  UserStatsDailyRow,
  UserStatsRow,
  UserStreakRow,
} from '../services/stats-repository';
import { useAuthStore } from '../state/auth-store';
import { colors, radius, spacing, typography } from '../theme/tokens';

// Stats (Screen 12), DESIGN_GUIDELINES §0: an acquisition surface. Lifetime
// aggregates (`user_stats` — proven server-side to equal
// sum(rewards_history.points), Phase 5 DoD; this screen just renders that
// already-authoritative value, never recomputes it), current/longest
// streak, a 7-day chart, and the achieved-milestone list. Same
// non-blocking-fetch posture as HomeScreen.tsx: real zeros render
// immediately, filled in once the reads resolve.
type StatsScreenProps = NativeStackScreenProps<RootStackParamList, 'Stats'>;

// No charting library in this codebase (apps/mobile/package.json) and no
// color tokens exist yet (palette deferred, DESIGN_GUIDELINES §11) — seven
// flex-height <View> bars, token-styled, RTL-safe for free since
// flexDirection: 'row' already respects I18nManager.
const MAX_BAR_HEIGHT = 80;
const MIN_BAR_HEIGHT = 4;

interface StatsSummary {
  readonly stats: UserStatsRow | null;
  readonly streak: UserStreakRow | null;
  readonly daily: readonly UserStatsDailyRow[];
  readonly milestoneProgress: MilestoneProgress | null;
}

// navigation/route are unused: Stats has no outgoing navigation of its
// own, same posture as HistoryScreen.tsx.
const StatsScreen = (_props: StatsScreenProps): React.JSX.Element => {
  const { t, i18n } = useTranslation();
  const userId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );
  const [summary, setSummary] = useState<StatsSummary | null>(null);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    let cancelled = false;
    const days = getLastSevenLocalDays();

    Promise.all([
      fetchUserStats(userId),
      fetchUserStreak(userId),
      fetchDailyStats(userId, days[0]),
      fetchMilestoneProgress(userId),
    ]).then(([statsResult, streakResult, dailyResult, milestoneResult]) => {
      if (cancelled) {
        return;
      }
      setSummary({
        stats: statsResult.ok ? statsResult.value : null,
        streak: streakResult.ok ? streakResult.value : null,
        daily: dailyResult.ok ? dailyResult.value : [],
        milestoneProgress: milestoneResult.ok ? milestoneResult.value : null,
      });
    });

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const totalPoints = summary?.stats?.total_points ?? 0;
  const totalMinutes = summary?.stats?.total_minutes ?? 0;
  const currentStreak = summary?.streak?.current_streak ?? 0;
  const longestStreak = summary?.streak?.longest_streak ?? 0;

  const days = getLastSevenLocalDays();
  const dailyByDay = new Map((summary?.daily ?? []).map((row) => [row.day, row]));
  const chartPoints = days.map((day) => ({ day, points: dailyByDay.get(day)?.points ?? 0 }));
  const maxPoints = Math.max(...chartPoints.map((point) => point.points), 1);
  const allZero = chartPoints.every((point) => point.points === 0);

  const milestoneProgress = summary?.milestoneProgress ?? null;
  const achievedMilestones =
    milestoneProgress?.milestones.filter((milestone) =>
      milestoneProgress.achievedMilestoneIds.has(milestone.id),
    ) ?? [];

  return (
    <View style={styles.container} testID="stats-screen">
      <Text style={styles.title}>{t('stats.title')}</Text>

      <View style={styles.lifetimeRow}>
        <View style={styles.lifetimeCard}>
          <Text style={styles.lifetimeValue} testID="stats-total-points">
            {totalPoints}
          </Text>
          <Text style={styles.lifetimeCaption}>{t('stats.totalPoints')}</Text>
        </View>
        <View style={styles.lifetimeCard}>
          <Text style={styles.lifetimeValue} testID="stats-total-minutes">
            {totalMinutes}
          </Text>
          <Text style={styles.lifetimeCaption}>{t('stats.totalMinutes')}</Text>
        </View>
      </View>

      <View style={styles.streakRow}>
        <View style={styles.streakBlock}>
          <Text style={styles.streakValue} testID="stats-current-streak">
            {currentStreak}
          </Text>
          <Text style={styles.lifetimeCaption}>{t('stats.currentStreak')}</Text>
        </View>
        <View style={styles.streakBlock}>
          <Text style={styles.streakValue} testID="stats-longest-streak">
            {longestStreak}
          </Text>
          <Text style={styles.lifetimeCaption}>{t('stats.longestStreak')}</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('stats.chartTitle')}</Text>
      <View style={styles.chartRow} testID="stats-chart">
        {chartPoints.map((point) => {
          const height = allZero
            ? MIN_BAR_HEIGHT
            : Math.max((point.points / maxPoints) * MAX_BAR_HEIGHT, MIN_BAR_HEIGHT);
          // An Intl.DateTimeFormat option value, not user-facing copy — the
          // rendered label itself is fully localized via i18n.language.
          const label = new Date(`${point.day}T00:00:00`).toLocaleDateString(i18n.language, {
            // eslint-disable-next-line i18next/no-literal-string
            weekday: 'short',
          });
          return (
            <View key={point.day} style={styles.chartBarColumn} testID={`stats-bar-${point.day}`}>
              <View style={styles.chartBarTrack}>
                <View style={[styles.chartBarFill, { height }]} />
              </View>
              <Text style={styles.chartBarLabel}>{label}</Text>
            </View>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>{t('stats.milestonesTitle')}</Text>
      {achievedMilestones.length === 0 ? (
        <Text style={styles.emptyText} testID="stats-milestones-empty">
          {t('stats.noMilestonesYet')}
        </Text>
      ) : (
        <View testID="stats-milestones-list">
          {achievedMilestones.map((milestone) => (
            <Text key={milestone.id} style={styles.milestoneRow}>
              {translateMilestoneName(t, milestone.slug)}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
};

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  chartBarColumn: {
    alignItems: 'center',
    flex: 1,
  },
  chartBarFill: {
    backgroundColor: colors.primary,
    borderRadius: radius.sm,
    width: '60%',
  },
  chartBarLabel: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  chartBarTrack: {
    alignItems: 'center',
    height: MAX_BAR_HEIGHT,
    justifyContent: 'flex-end',
    width: '100%',
  },
  chartRow: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    marginBottom: spacing.lg,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing['2xl'],
  },
  emptyText: {
    ...typography.body,
    color: colors.textMuted,
  },
  lifetimeCaption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  lifetimeCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.xl,
    flex: 1,
    paddingVertical: spacing.lg,
  },
  lifetimeRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing.lg,
  },
  lifetimeValue: {
    ...typography.display,
    color: colors.textPrimary,
  },
  milestoneRow: {
    ...typography.body,
    color: colors.textPrimary,
    paddingVertical: spacing.xs,
  },
  sectionTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  streakBlock: {
    alignItems: 'center',
    flex: 1,
  },
  streakRow: {
    flexDirection: 'row',
    gap: spacing.md,
    marginBottom: spacing['2xl'],
  },
  streakValue: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
    marginBottom: spacing['2xl'],
    textAlign: 'center',
  },
});

export default StatsScreen;
