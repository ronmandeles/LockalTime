import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import StatusBanner from '../components/StatusBanner';
import { DEFAULT_BLOCKED_CATEGORIES } from '../config/blocked-categories';
import { useAppBlocker } from '../hooks/use-app-blocker';
import { useHostMigrationToast } from '../hooks/use-host-migration-toast';
import { useSession } from '../hooks/use-session';
import type { RootStackParamList } from '../navigation/types';
import { setActiveSession } from '../state/active-session-store';
import { useAuthStore } from '../state/auth-store';
import { colors, sizing, spacing, typography } from '../theme/tokens';

// Phase 6 task 7: statuses whose own realtime-connectivity meaning
// deserves a dedicated banner, distinct from host_disconnected (which
// already gets the quieter status label alone — the host-migration toast
// is the only dedicated surface for THAT state, and only for the newly-
// promoted host). degraded_offline is the native blocker's own 30-minute
// cutoff having fired; participant_reconnecting is the socket-health
// signal from session-channel.ts. Weight escalates from quiet to
// prominent as the situation gets more severe.
const OFFLINE_BANNER_WEIGHT: Partial<Record<string, 'quiet' | 'prominent'>> = {
  participant_reconnecting: 'quiet',
  degraded_offline: 'prominent',
};

// Phase 6 task 7: a session that ended while this screen was open must not
// strand the participant on a dead in-session view — every OTHER
// participant besides the one who triggered the end (host-ended, duration-
// reached, or the 24h force-terminated cap) only ever learns about it via
// this same CDC-delivered status transition, never their own action.
const TERMINAL_STATUSES = new Set(['completed', 'force_terminated']);

// Session statuses in which the blocker should keep running — everything
// short of a terminal/not-yet-started status. host_disconnected /
// participant_reconnecting / degraded_offline are still an ongoing session
// (ARCHITECTURE.md §6), so a brief presence hiccup must not lift the block.
const BLOCKING_STATUSES = new Set([
  'active',
  'host_disconnected',
  'participant_reconnecting',
  'degraded_offline',
]);

// Active Session (Screen 6). DESIGN_GUIDELINES §0: an IN-SESSION surface —
// deliberately quiet, no stimulation beyond what's functionally necessary
// (the timer, the participant list). useSession is the single source of
// truth; this screen only formats what the hook already hydrated/derived
// from realtime events — it never computes points or trusts a Broadcast
// payload directly (.claude/skills/supabase-integration/SKILL.md). The
// participant list is driven by openIntervals (live open presence
// intervals), not session_participants (only populated at session close,
// DATABASE.md design note).
type ActiveSessionScreenProps = NativeStackScreenProps<RootStackParamList, 'ActiveSession'>;

const formatClock = (totalSeconds: number): string => {
  const clamped = Math.max(0, Math.round(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

const ActiveSessionScreen = ({ route, navigation }: ActiveSessionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const { session, openIntervals, status, reportOfflineTimeout } = useSession(route.params.sessionId);
  const [now, setNow] = useState(() => Date.now());
  const currentUserId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );
  // ARCHITECTURE.md §6: only the newly-promoted host sees this, nobody else.
  const showHostMigrationToast = useHostMigrationToast(session?.host_id ?? null, currentUserId);

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  // From this mount on, an interrupted relaunch (killed app, dropped past
  // the offline cutoff) has a session to offer Screen 13 (Welcome Back) a
  // rejoin for — cleared again once SessionCompletionScreen mounts.
  useEffect(() => {
    setActiveSession(route.params.sessionId);
  }, [route.params.sessionId]);

  // Phase 6 task 7: reset (never navigate) into the receipt the instant the
  // machine reports a terminal status — matches EmergencyExitScreen's own
  // navigation.reset so a finished session is never reachable again via
  // back-gesture, and this is the only place that transition is observed
  // for every participant besides whoever caused it.
  useEffect(() => {
    if (TERMINAL_STATUSES.has(status)) {
      navigation.reset({
        index: 0,
        routes: [{ name: 'SessionCompletion', params: { sessionId: route.params.sessionId } }],
      });
    }
  }, [status, navigation, route.params.sessionId]);

  // Absolute server timestamp, never "now + duration" (ARCHITECTURE.md §8
  // item 5) — derived from the server-issued started_at, not the device
  // clock's `now`. null (open-ended, or not yet started) means no
  // self-timeout on the native side.
  const endsAt =
    session !== null &&
    session.duration_mode === 'fixed' &&
    session.started_at !== null &&
    session.planned_duration_minutes !== null
      ? new Date(
          new Date(session.started_at).getTime() + session.planned_duration_minutes * 60_000,
        ).toISOString()
      : null;

  // Called unconditionally, before the loading early-return below, so hook
  // order stays stable across renders (rules of hooks) — sessionId/
  // isSessionActive simply start out null/false while session is still
  // hydrating.
  const { violation } = useAppBlocker({
    sessionId: session?.id ?? null,
    isSessionActive: session !== null && BLOCKING_STATUSES.has(status),
    endsAt,
    // The session row's own blocklist, chosen by the host at creation and
    // frozen for the session's lifetime (plan §9a). Falls back to the
    // historical default only while the row is still hydrating — the hook
    // isn't started until isSessionActive anyway.
    blockedCategories: session?.blocked_categories ?? DEFAULT_BLOCKED_CATEGORIES,
    blockedPackages: session?.blocked_packages ?? [],
    onOfflineTimeout: reportOfflineTimeout,
  });

  if (session === null) {
    return (
      <View style={styles.container} testID="active-session-screen">
        <ActivityIndicator testID="active-session-loading" />
      </View>
    );
  }

  const statusLabel = t(`activeSession.status.${status}` as never, { defaultValue: status });

  let timerLabel: string | null = null;
  let timerValue: string | null = null;
  if (session.started_at !== null) {
    const elapsedSeconds = (now - new Date(session.started_at).getTime()) / 1000;
    if (session.duration_mode === 'fixed' && session.planned_duration_minutes !== null) {
      const remainingSeconds = session.planned_duration_minutes * 60 - elapsedSeconds;
      timerLabel = t('activeSession.timer.remaining');
      timerValue = formatClock(remainingSeconds);
    } else {
      timerLabel = t('activeSession.timer.elapsed');
      timerValue = formatClock(elapsedSeconds);
    }
  }

  return (
    <View style={styles.container} testID="active-session-screen">
      <Text style={styles.title}>{t('activeSession.title')}</Text>
      <Text style={styles.status}>{statusLabel}</Text>

      {showHostMigrationToast && (
        <StatusBanner
          message={t('activeSession.hostMigrationToast')}
          testID="active-session-host-migration-toast"
        />
      )}

      {OFFLINE_BANNER_WEIGHT[status] !== undefined && (
        <StatusBanner
          message={t(`activeSession.offlineBanner.${status}` as never)}
          weight={OFFLINE_BANNER_WEIGHT[status]}
          testID="active-session-offline-banner"
        />
      )}

      {violation !== null && (
        <StatusBanner
          message={t(`activeSession.blockerViolation.message.${violation.reason}`)}
          weight="prominent"
          actionLabel={t('activeSession.blockerViolation.openSettings')}
          onAction={() => Linking.openSettings()}
          testID="active-session-blocker-violation"
        />
      )}

      {timerValue !== null && (
        <View style={styles.timerCard}>
          <Text style={styles.timerLabel}>{timerLabel}</Text>
          <Text style={styles.timerValue} testID="active-session-timer">
            {timerValue}
          </Text>
        </View>
      )}

      {route.params.qrToken !== undefined && (
        <View style={styles.qrCard}>
          <Text style={styles.qrLabel}>{t('activeSession.qrLabel')}</Text>
          <Text style={styles.qrValue} testID="active-session-qr-value">
            {route.params.qrToken}
          </Text>
        </View>
      )}

      <View style={styles.participants}>
        <Text style={styles.sectionTitle}>{t('activeSession.participants.title')}</Text>
        {openIntervals.length === 0 ? (
          <Text style={styles.body}>{t('activeSession.participants.empty')}</Text>
        ) : (
          <>
            <Text style={styles.caption}>
              {t('activeSession.participants.count', { count: openIntervals.length })}
            </Text>
            {openIntervals.map((interval) => (
              <Text
                key={interval.id}
                style={styles.participantRow}
                testID={`active-session-participant-${interval.user_id}`}
              >
                {interval.user_id}
              </Text>
            ))}
          </>
        )}
      </View>

      {BLOCKING_STATUSES.has(status) && (
        <TouchableOpacity
          onPress={() => navigation.navigate('EmergencyExit', { sessionId: route.params.sessionId })}
          testID="active-session-emergency-exit"
        >
          <Text style={styles.emergencyExitLabel}>{t('activeSession.emergencyExit')}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  caption: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.sm,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  emergencyExitLabel: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing['2xl'],
    minHeight: sizing.minTouchTarget,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  participantRow: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  participants: {
    marginTop: spacing.lg,
  },
  qrCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  qrLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  qrValue: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  status: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  timerCard: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 16,
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
  },
  timerLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  timerValue: {
    ...typography.display,
    color: colors.textPrimary,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
});

export default ActiveSessionScreen;
