import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { fetchRewardsHistory, fetchSessionParticipant } from '../services/session-repository';
import type { RewardsHistoryRow, SessionParticipantRow } from '../services/session-repository';
import { clearActiveSession } from '../state/active-session-store';
import { useAuthStore } from '../state/auth-store';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Session Completion (Screen 10), DESIGN_GUIDELINES §0: an acquisition
// surface — full design effort, reached either from a normal session end
// (host-ended/duration-reached/force-terminated, via end-session.ts) or a
// successful Emergency Exit (via finalize-emergency-exit.ts). Both write
// the same session_participants/rewards_history shape, so this screen
// never branches on how it got here — only on the already-computed
// exit_reason, per the Money-Equivalent Logic Rule: points and bonuses are
// read exactly as the server finalized them, never recomputed client-side.
type SessionCompletionScreenProps = NativeStackScreenProps<RootStackParamList, 'SessionCompletion'>;

const SessionCompletionScreen = ({
  route,
  navigation,
}: SessionCompletionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const userId = useAuthStore((state) =>
    state.auth.status === 'authenticated' ? state.auth.session.user.id : null,
  );
  // undefined = still loading; null = fetch succeeded but nothing to show
  // yet (finalization hasn't landed) or the fetch itself failed — both
  // render the same "not ready" fallback, since there's nothing more
  // specific to tell the user either way.
  const [participant, setParticipant] = useState<SessionParticipantRow | null | undefined>(undefined);
  const [rewards, setRewards] = useState<readonly RewardsHistoryRow[]>([]);

  // The session has a real, final receipt now — no longer "interrupted", so
  // it must never trigger Screen 13 (Welcome Back) again on a future cold
  // start.
  useEffect(() => {
    clearActiveSession();
  }, []);

  useEffect(() => {
    if (userId === null) {
      return undefined;
    }
    let cancelled = false;

    Promise.all([
      fetchSessionParticipant(route.params.sessionId, userId),
      fetchRewardsHistory(route.params.sessionId, userId),
    ]).then(([participantResult, rewardsResult]) => {
      if (cancelled) {
        return;
      }
      setParticipant(participantResult.ok ? participantResult.value : null);
      setRewards(rewardsResult.ok ? rewardsResult.value : []);
    });

    return () => {
      cancelled = true;
    };
  }, [route.params.sessionId, userId]);

  const handleDone = (): void => {
    // reset, not navigate — Done is the end of this flow, so the session
    // (and Emergency Exit, if that's how we got here) should never be
    // reachable via the back gesture afterward.
    navigation.reset({ index: 0, routes: [{ name: 'Home' }] });
  };

  if (participant === undefined) {
    return (
      <View style={styles.container} testID="session-completion-screen">
        <ActivityIndicator testID="session-completion-loading" />
      </View>
    );
  }

  if (participant === null) {
    return (
      <View style={styles.container} testID="session-completion-screen">
        <Text style={styles.body}>{t('sessionCompletion.notReady')}</Text>
        <TouchableOpacity style={styles.doneCta} onPress={handleDone} testID="session-completion-done">
          <Text style={styles.doneCtaLabel}>{t('sessionCompletion.done')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isCompleted = participant.exit_reason === 'completed';
  const baseRow = rewards.find((row) => row.bonus_type === 'base');
  const groupRow = rewards.find((row) => row.bonus_type === 'group_bonus');
  const completionRow = rewards.find((row) => row.bonus_type === 'completion_bonus');

  return (
    <View style={styles.container} testID="session-completion-screen">
      <Text style={styles.title}>
        {t(isCompleted ? 'sessionCompletion.title.completed' : 'sessionCompletion.title.left')}
      </Text>

      <View style={styles.pointsCard}>
        <Text style={styles.pointsLabel}>{t('sessionCompletion.pointsEarned')}</Text>
        <Text style={styles.pointsValue} testID="session-completion-points">
          {participant.points_earned}
        </Text>
        <Text style={styles.caption}>
          {t('sessionCompletion.minutesPresent', { count: participant.total_minutes_present })}
        </Text>
      </View>

      <View style={styles.breakdown}>
        {baseRow !== undefined && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('sessionCompletion.breakdown.base')}</Text>
            <Text style={styles.breakdownValue}>+{baseRow.points}</Text>
          </View>
        )}
        {groupRow !== undefined && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('sessionCompletion.breakdown.groupBonus')}</Text>
            <Text style={styles.breakdownValue}>+{groupRow.points}</Text>
          </View>
        )}
        {completionRow !== undefined && (
          <View style={styles.breakdownRow}>
            <Text style={styles.breakdownLabel}>{t('sessionCompletion.breakdown.completionBonus')}</Text>
            <Text style={styles.breakdownValue}>+{completionRow.points}</Text>
          </View>
        )}
      </View>

      {!isCompleted && <Text style={styles.forfeitedNote}>{t('sessionCompletion.forfeitedNote')}</Text>}

      <TouchableOpacity style={styles.doneCta} onPress={handleDone} testID="session-completion-done">
        <Text style={styles.doneCtaLabel}>{t('sessionCompletion.done')}</Text>
      </TouchableOpacity>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: '#444444',
  },
  breakdown: {
    marginTop: spacing.lg,
  },
  breakdownLabel: {
    ...typography.body,
    color: '#444444',
  },
  breakdownRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  breakdownValue: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  caption: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing['2xl'],
  },
  doneCta: {
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  doneCtaLabel: {
    ...typography.bodyStrong,
    color: '#FFFFFF',
  },
  forfeitedNote: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.lg,
  },
  pointsCard: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.xl,
    marginTop: spacing.lg,
    paddingVertical: spacing.xl,
  },
  pointsLabel: {
    ...typography.caption,
    color: '#666666',
  },
  pointsValue: {
    ...typography.display,
    color: '#222222',
    marginTop: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
});

export default SessionCompletionScreen;
