import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import { BLOCKED_CATEGORIES } from '../config/blocked-categories';
import { useAppBlocker } from '../hooks/use-app-blocker';
import { useHostMigrationToast } from '../hooks/use-host-migration-toast';
import { useSession } from '../hooks/use-session';
import type { RootStackParamList } from '../navigation/types';
import { useAuthStore } from '../state/auth-store';
import { radius, sizing, spacing, typography } from '../theme/tokens';

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
    blockedCategories: BLOCKED_CATEGORIES,
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
        <View style={styles.hostMigrationToast} testID="active-session-host-migration-toast">
          <Text style={styles.hostMigrationToastText}>{t('activeSession.hostMigrationToast')}</Text>
        </View>
      )}

      {violation !== null && (
        <View style={styles.violationBanner} testID="active-session-blocker-violation">
          <Text style={styles.violationMessage}>
            {t(`activeSession.blockerViolation.message.${violation.reason}`)}
          </Text>
          <TouchableOpacity onPress={() => Linking.openSettings()} testID="active-session-open-settings">
            <Text style={styles.violationOpenSettings}>
              {t('activeSession.blockerViolation.openSettings')}
            </Text>
          </TouchableOpacity>
        </View>
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
          <Text style={styles.qrValue}>{route.params.qrToken}</Text>
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

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: '#444444',
    marginTop: spacing.sm,
  },
  caption: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.sm,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  emergencyExitLabel: {
    ...typography.caption,
    color: '#999999',
    marginTop: spacing['2xl'],
    minHeight: sizing.minTouchTarget,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  hostMigrationToast: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  hostMigrationToastText: {
    ...typography.caption,
    color: '#222222',
  },
  participantRow: {
    ...typography.body,
    color: '#222222',
    marginTop: spacing.xs,
  },
  participants: {
    marginTop: spacing.lg,
  },
  qrCard: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  qrLabel: {
    ...typography.caption,
    color: '#666666',
  },
  qrValue: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.xs,
  },
  sectionTitle: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  status: {
    ...typography.body,
    color: '#666666',
    marginTop: spacing.xs,
  },
  timerCard: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: 16,
    marginTop: spacing.lg,
    paddingVertical: spacing.lg,
  },
  timerLabel: {
    ...typography.caption,
    color: '#666666',
  },
  timerValue: {
    ...typography.display,
    color: '#222222',
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
  violationBanner: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
    marginTop: spacing.lg,
    padding: spacing.md,
  },
  violationMessage: {
    ...typography.body,
    color: '#222222',
  },
  violationOpenSettings: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
});

export default ActiveSessionScreen;
