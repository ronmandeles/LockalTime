import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { translateMilestoneName } from '../i18n/translate-milestone-name';
import type { RootStackParamList } from '../navigation/types';
import {
  fetchMilestoneProgress,
  fetchUserStats,
  fetchUserStreak,
} from '../services/stats-repository';
import type {
  MilestoneProgress,
  UserStatsRow,
  UserStreakRow,
} from '../services/stats-repository';
import { useAuthStore } from '../state/auth-store';
import { useProfileStore } from '../state/profile-store';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Home (Screen 4). Phase 5 (docs/RETENTION_STRATEGY.md §2) adds a
// gamification summary card — streak, lifetime points, and a milestone
// progress bar (the one new adopted retention mechanic: the goal-gradient
// effect, motivation rising as a visible target nears). Per
// ARCHITECTURE.md §9, these stay visually quiet — a fact being stated, not
// a prize being dangled: no idle animation, same neutral grayscale as
// every other token-styled element here. The two original CTAs (create/
// join) remain DESIGN_GUIDELINES §1's reference model for the screen's own
// primary action; the summary card sits above them, informational only, no
// competing call to action of its own.
//
// Data-fetching follows SessionCompletionScreen.tsx's established pattern:
// userId via useAuthStore selector, one effect with a `cancelled` guard,
// Promise.all. Deliberately does NOT gate the screen behind a loading
// state the way that screen does — the summary card renders real zeros
// immediately and fills in once the fetch resolves, so Create/Scan are
// never blocked by it (this screen's original "no session-lookup blocks
// the CTAs" posture, extended rather than abandoned).
type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

interface HomeSummary {
  readonly stats: UserStatsRow | null;
  readonly streak: UserStreakRow | null;
  readonly milestoneProgress: MilestoneProgress | null;
}

const HomeScreen = ({ navigation }: HomeScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const userId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );
  // Phase 6: gates the manageVenuesCta link below. Reads the already-
  // hydrated store directly (App.tsx fires hydrateProfile on sign-in) —
  // this screen never fetches it itself.
  const role = useProfileStore((state) => state.role);
  const isVerifiedHost = role === 'verified_host' || role === 'admin';
  const [summary, setSummary] = useState<HomeSummary | null>(null);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    let cancelled = false;

    Promise.all([fetchUserStats(userId), fetchUserStreak(userId), fetchMilestoneProgress(userId)]).then(
      ([statsResult, streakResult, milestoneResult]) => {
        if (cancelled) {
          return;
        }
        setSummary({
          stats: statsResult.ok ? statsResult.value : null,
          streak: streakResult.ok ? streakResult.value : null,
          milestoneProgress: milestoneResult.ok ? milestoneResult.value : null,
        });
      },
    );

    return () => {
      cancelled = true;
    };
  }, [userId]);

  const totalPoints = summary?.stats?.total_points ?? 0;
  const currentStreak = summary?.streak?.current_streak ?? 0;
  // "Any session with presence" — the same forgiving counting rule
  // apply_session_stats() uses server-side for both the streak and the
  // milestone ladder (docs/RETENTION_STRATEGY.md §1), so this client-side
  // arithmetic never disagrees with what actually crossed a threshold.
  const totalSessions =
    (summary?.stats?.sessions_completed ?? 0) +
    (summary?.stats?.sessions_emergency_exit ?? 0) +
    (summary?.stats?.sessions_disconnected ?? 0);

  const milestoneProgress = summary?.milestoneProgress ?? null;
  const nextMilestone =
    milestoneProgress?.milestones.find(
      (milestone) => !milestoneProgress.achievedMilestoneIds.has(milestone.id),
    ) ?? null;
  const remainingSessions =
    nextMilestone !== null ? Math.max(nextMilestone.sessions_required - totalSessions, 0) : 0;
  const progressRatio =
    nextMilestone !== null ? Math.min(totalSessions / nextMilestone.sessions_required, 1) : 1;

  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title}>{t('home.title')}</Text>

      <View style={styles.summaryCard} testID="home-summary-card">
        <View style={styles.summaryRow}>
          <Text style={styles.summaryValue} testID="home-total-points">
            {totalPoints}
          </Text>
          <Text style={styles.summaryCaption}>{t('home.summary.totalPoints')}</Text>
        </View>
        <Text style={styles.streakText} testID="home-streak">
          {currentStreak > 0
            ? t('home.summary.streakCount', { count: currentStreak })
            : t('home.summary.streakNone')}
        </Text>

        {nextMilestone !== null ? (
          <View style={styles.milestoneBlock} testID="home-milestone-progress">
            <Text style={styles.milestoneCaption}>
              {t('home.summary.milestoneProgress', {
                count: remainingSessions,
                milestone: translateMilestoneName(t, nextMilestone.slug),
              })}
            </Text>
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { width: `${progressRatio * 100}%` }]} />
            </View>
          </View>
        ) : (
          milestoneProgress !== null && (
            <Text style={styles.milestoneCaption} testID="home-milestone-progress">
              {t('home.summary.allMilestonesReached')}
            </Text>
          )
        )}
      </View>

      <View style={styles.actions}>
        <TouchableOpacity
          onPress={() => navigation.navigate('CreateSession')}
          style={styles.primaryCta}
          testID="home-create-session-cta"
        >
          <Text style={styles.primaryCtaLabel}>{t('home.createSession')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('ScanSession')}
          style={styles.secondaryCta}
          testID="home-scan-qr-cta"
        >
          <Text style={styles.secondaryCtaLabel}>{t('home.scanQr')}</Text>
        </TouchableOpacity>
      </View>

      {/* Subdued text links, not a third/fourth competing CTA
          (DESIGN_GUIDELINES §1) — Create/Scan remain the screen's one
          primary action. */}
      <View style={styles.secondaryLinkRow}>
        <TouchableOpacity
          onPress={() => navigation.navigate('History')}
          style={styles.secondaryLink}
          testID="home-history-cta"
        >
          <Text style={styles.secondaryLinkLabel}>{t('home.historyCta')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Stats')}
          style={styles.secondaryLink}
          testID="home-stats-cta"
        >
          <Text style={styles.secondaryLinkLabel}>{t('home.statsCta')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Friends')}
          style={styles.secondaryLink}
          testID="home-friends-cta"
        >
          <Text style={styles.secondaryLinkLabel}>{t('home.friendsCta')}</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() => navigation.navigate('Settings')}
          style={styles.secondaryLink}
          testID="home-settings-cta"
        >
          <Text style={styles.secondaryLinkLabel}>{t('home.settingsCta')}</Text>
        </TouchableOpacity>
        {isVerifiedHost && (
          <TouchableOpacity
            onPress={() => navigation.navigate('VenueManagement')}
            style={styles.secondaryLink}
            testID="home-manage-venues-cta"
          >
            <Text style={styles.secondaryLinkLabel}>{t('home.manageVenuesCta')}</Text>
          </TouchableOpacity>
        )}
        {isVerifiedHost && (
          <TouchableOpacity
            onPress={() => navigation.navigate('VenueDashboard')}
            style={styles.secondaryLink}
            testID="home-venue-dashboard-cta"
          >
            <Text style={styles.secondaryLinkLabel}>{t('home.venueDashboardCta')}</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  actions: {
    gap: spacing.md,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'flex-start',
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing['2xl'],
  },
  milestoneBlock: {
    marginTop: spacing.md,
  },
  milestoneCaption: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.md,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: '#FFFFFF',
  },
  progressFill: {
    backgroundColor: '#222222',
    borderRadius: radius.full,
    height: '100%',
  },
  progressTrack: {
    backgroundColor: '#E0E0E0',
    borderRadius: radius.full,
    height: 8,
    marginTop: spacing.xs,
    overflow: 'hidden',
  },
  secondaryCta: {
    alignItems: 'center',
    borderColor: '#222222',
    borderRadius: radius.md,
    borderWidth: 1,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  secondaryCtaLabel: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  secondaryLink: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
  },
  secondaryLinkLabel: {
    ...typography.body,
    color: '#666666',
  },
  secondaryLinkRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  streakText: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  summaryCard: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.xl,
    marginBottom: spacing['2xl'],
    padding: spacing.lg,
  },
  summaryCaption: {
    ...typography.caption,
    color: '#666666',
    marginStart: spacing.sm,
  },
  summaryRow: {
    alignItems: 'baseline',
    flexDirection: 'row',
  },
  summaryValue: {
    ...typography.display,
    color: '#222222',
  },
  title: {
    ...typography.display,
    color: '#222222',
    marginBottom: spacing['2xl'],
    textAlign: 'center',
  },
});

export default HomeScreen;
