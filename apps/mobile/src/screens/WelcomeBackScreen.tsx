import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { fetchSession } from '../services/session-repository';
import type { SessionRow } from '../services/session-repository';
import { clearActiveSession, resolveWelcomeBack } from '../state/active-session-store';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Screen 13 — Welcome Back / Session Interrupted (Phase 4 task 12,
// ARCHITECTURE.md §2 item 13). A pre-navigator conditional gate, same shape
// as OnboardingScreen/PermissionPrimingScreen — App.tsx renders it outside
// the NavigationContainer, before it exists, so this screen can't call
// navigation.navigate() itself. It resolves what App's one subsequent
// Navigator mount should do via resolveWelcomeBack() (active-session-store.ts)
// instead.
//
// Shows elapsed presence TIME, deliberately never a points figure: an
// in-progress session has no authoritative points value yet (bonuses aren't
// decided until it ends), and the Money-Equivalent Logic Rule (CLAUDE.md)
// forbids showing anything else, including a provisional estimate.
export interface WelcomeBackScreenProps {
  readonly sessionId: string;
}

const OPEN_STATUSES: ReadonlySet<string> = new Set(['pending', 'active']);

const WelcomeBackScreen = ({ sessionId }: WelcomeBackScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [session, setSession] = useState<SessionRow | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetchSession(sessionId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok || !OPEN_STATUSES.has(result.value.status)) {
        // Either the session is gone, or it already ended while this device
        // was away — either way it's no longer "interrupted", so it must
        // never trigger this gate again on a future cold start.
        clearActiveSession();
        resolveWelcomeBack(result.ok ? { screen: 'SessionCompletion', sessionId } : null);
        return;
      }
      setSession(result.value);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (session === undefined) {
    return (
      <View style={styles.container} testID="welcome-back-screen">
        <ActivityIndicator testID="welcome-back-loading" />
      </View>
    );
  }

  const elapsedMinutes =
    session.started_at !== null
      ? Math.max(0, Math.floor((Date.now() - new Date(session.started_at).getTime()) / 60_000))
      : null;

  const handleRejoin = (): void => {
    resolveWelcomeBack({ screen: 'SessionDetails', sessionId });
  };

  return (
    <View style={styles.container} testID="welcome-back-screen">
      <View style={styles.content}>
        <Text style={styles.title}>{t('welcomeBack.title')}</Text>
        {elapsedMinutes !== null && (
          <Text style={styles.body}>{t('welcomeBack.minutesElapsed', { count: elapsedMinutes })}</Text>
        )}
      </View>
      <TouchableOpacity style={styles.primaryCta} onPress={handleRejoin} testID="welcome-back-rejoin">
        <Text style={styles.primaryCtaLabel}>{t('welcomeBack.rejoin')}</Text>
      </TouchableOpacity>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: '#444444',
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
  content: {
    flex: 1,
    justifyContent: 'center',
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
  title: {
    ...typography.heading,
    color: '#222222',
  },
});

export default WelcomeBackScreen;
