import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { blockingPermissions, requestBatteryOptimizationExemption } from '../services/blocking-permissions';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// Permission-priming screen (Screen 2), DESIGN_GUIDELINES §9: one screen
// resolving the "why permissions" hesitation, one primary action per state
// (§1). Two states, a discriminated union: 'priming' (copy + Allow, which
// asks the blocking-permissions service to request) and 'denied' (the
// recovery fallback: explanatory copy, open-settings — Linking.openSettings
// is the sole OS touchpoint — and proceed-anyway, because denial must never
// hard-wall the app; the full reasoning is pinned in
// PermissionPrimingScreen.spec.tsx). An 'undetermined' request result leaves
// the priming state intact for a retry — neither completion nor fallback.
//
// Phase 3 task 3.2: Usage Access / Overlay are granted in a Settings screen
// the app gets no direct callback from, so an AppState 'change' listener
// re-checks getStatus() whenever the app returns to 'active' while in the
// denied state — the only way "open settings, grant it, come back" actually
// resolves. A real grant (either from request() or this recheck) also fires
// requestBatteryOptimizationExemption() as a fire-and-forget reliability ask
// (ARCHITECTURE.md §8 item 13) — separate from the granted/denied capability
// itself, so its outcome is never awaited or gated on.
//
// Like OnboardingScreen, the screen is storage-agnostic: it only fires
// onHandled (granted result or proceed-anyway); the App gate owns persistence
// and what handling means. All copy flows through t() (placeholder, flagged
// in the locale bundles); styling is token-based, neutral grayscale only
// (palette deferred), and direction-neutral per .claude/skills/i18n/SKILL.md.

interface PermissionPrimingScreenProps {
  readonly onHandled: () => void;
}

type ScreenState = 'priming' | 'denied';

const PermissionPrimingScreen = ({
  onHandled,
}: PermissionPrimingScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [screenState, setScreenState] = useState<ScreenState>('priming');

  const handleGranted = (): void => {
    requestBatteryOptimizationExemption().catch(() => undefined);
    onHandled();
  };

  const handleAllowPress = (): void => {
    // Never rejects per the service contract, so no catch branch exists to
    // get wrong; the screen only maps the discriminated result.
    blockingPermissions.request().then((result) => {
      if (result.status === 'granted') {
        handleGranted();
        return;
      }
      if (result.status === 'denied') {
        setScreenState('denied');
      }
      // 'undetermined': the OS flow ended without an answer — stay in the
      // priming state so Allow remains available for a retry.
    });
  };

  const handleOpenSettingsPress = (): void => {
    // Recovery, not completion: the user returns from settings to retry, so
    // this deliberately does NOT fire onHandled.
    Linking.openSettings();
  };

  // Stable refs so the AppState effect below only subscribes once (deps
  // `[]`) instead of tearing down and re-subscribing on every render/state
  // change — it reads the latest screenState/onHandled via the ref when the
  // event actually fires.
  const screenStateRef = useRef(screenState);
  screenStateRef.current = screenState;
  const handleGrantedRef = useRef(handleGranted);
  handleGrantedRef.current = handleGranted;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active' || screenStateRef.current !== 'denied') {
        return;
      }
      blockingPermissions.getStatus().then((result) => {
        if (result.status === 'granted') {
          handleGrantedRef.current();
        }
      });
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.container} testID="permission-priming-screen">
      {screenState === 'priming' ? (
        <>
          <View style={styles.content}>
            <Text style={styles.title}>{t('permissionPriming.title')}</Text>
            <Text style={styles.body}>{t('permissionPriming.body')}</Text>
          </View>
          <TouchableOpacity
            onPress={handleAllowPress}
            style={styles.primaryCta}
            testID="permission-allow-cta"
          >
            <Text style={styles.primaryCtaLabel}>{t('permissionPriming.allow')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.content}>
            <Text style={styles.title}>{t('permissionPriming.denied.title')}</Text>
            <Text style={styles.body}>{t('permissionPriming.denied.body')}</Text>
          </View>
          <TouchableOpacity
            onPress={handleOpenSettingsPress}
            style={styles.primaryCta}
            testID="permission-open-settings-cta"
          >
            <Text style={styles.primaryCtaLabel}>{t('permissionPriming.denied.openSettings')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={onHandled}
            style={styles.proceedAnyway}
            testID="permission-proceed-anyway"
          >
            <Text style={styles.proceedAnywayLabel}>
              {t('permissionPriming.denied.proceedAnyway')}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  container: {
    backgroundColor: colors.background,
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
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
  proceedAnyway: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
    minWidth: sizing.minTouchTarget,
  },
  proceedAnywayLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
});

export default PermissionPrimingScreen;
