import React, { useEffect, useRef, useState } from 'react';
import { AppState, Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import GradientButton from '../components/GradientButton';
import IconBadge from '../components/IconBadge';
import LogoMark from '../components/LogoMark';
import { blockingPermissions, requestBatteryOptimizationExemption } from '../services/blocking-permissions';
import { colors, sizing, spacing, typography } from '../theme/tokens';

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
// That same listener also chains the two Android grants behind ONE Allow tap.
// Android needs Usage Access and Overlay separately, each in its own Settings
// screen, with no combined screen and no runtime dialog for either — so
// 'undetermined' means "a Settings screen is open", and on the return trip
// this screen re-drives request() rather than making the user press Allow a
// second time for the second permission. The loop guard is in the native
// module, not here: it only launches when the permission it last asked for
// actually became granted, and otherwise answers 'denied'. Without that, a
// user who backed out would be thrown straight back into Settings on every
// return, with no way out of the app.
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

  // True between launching a Settings screen and coming back from it. A ref,
  // not state: the AppState listener reads it, and re-rendering on it would
  // change nothing on screen.
  const awaitingSettingsReturnRef = useRef(false);

  // Drives one step of the grant sequence. Called by the Allow CTA, and again
  // by the foreground-return listener for each remaining permission.
  const requestBlockingPermission = (): void => {
    // Never rejects per the service contract, so no catch branch exists to
    // get wrong; the screen only maps the discriminated result.
    blockingPermissions.request().then((result) => {
      if (result.status === 'granted') {
        awaitingSettingsReturnRef.current = false;
        handleGranted();
        return;
      }
      if (result.status === 'denied') {
        // Either a real refusal or the native module declining to reopen a
        // screen the user just backed out of — both are the recovery state.
        awaitingSettingsReturnRef.current = false;
        setScreenState('denied');
        return;
      }
      // 'undetermined': a Settings screen is open now. Stay in the priming
      // state so Allow remains available, and let the return trip continue
      // the sequence.
      awaitingSettingsReturnRef.current = true;
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
  const requestBlockingPermissionRef = useRef(requestBlockingPermission);
  requestBlockingPermissionRef.current = requestBlockingPermission;

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') {
        return;
      }
      if (screenStateRef.current === 'denied') {
        // Recovery: the user left via open-settings, so only a status recheck
        // is owed. Never reopen Settings from here — the flow already ended.
        blockingPermissions.getStatus().then((result) => {
          if (result.status === 'granted') {
            handleGrantedRef.current();
          }
        });
        return;
      }
      // Mid-sequence: continue to whichever permission is still missing.
      if (awaitingSettingsReturnRef.current) {
        requestBlockingPermissionRef.current();
      }
    });
    return () => subscription.remove();
  }, []);

  // The reference design's shield-and-lock glyph has no equivalent here (no
  // icon library, and adding one would be this change's only native-linking
  // risk), so the badge holds the Lockal Time ring mark instead, tinted with
  // the accent and sized to sit inside the circle the way the reference's
  // glyph does.
  const badge = (
    <IconBadge testID="permission-icon-badge">
      <LogoMark
        color={colors.primary}
        size={sizing.iconBadge / 2}
        testID="permission-icon-badge-mark"
      />
    </IconBadge>
  );

  return (
    <SafeAreaView style={styles.container} testID="permission-priming-screen">
      {screenState === 'priming' ? (
        <>
          <View style={styles.content}>
            {badge}
            <Text style={styles.title}>{t('permissionPriming.title')}</Text>
            <Text style={styles.body}>{t('permissionPriming.body')}</Text>
          </View>
          <GradientButton
            label={t('permissionPriming.allow')}
            onPress={requestBlockingPermission}
            testID="permission-allow-cta"
          />
          {/* The escape hatch is offered up front, not only after a refusal
              (docs/NAVY_THEME_PLAN.md §1). Its own testID and locale key,
              separate from the denied state's proceed-anyway below: the two
              live in different states and their copy may diverge. */}
          <TouchableOpacity
            onPress={onHandled}
            style={styles.secondaryLink}
            testID="permission-maybe-later"
          >
            <Text style={styles.secondaryLinkLabel}>{t('permissionPriming.maybeLater')}</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <View style={styles.content}>
            {badge}
            <Text style={styles.title}>{t('permissionPriming.denied.title')}</Text>
            <Text style={styles.body}>{t('permissionPriming.denied.body')}</Text>
          </View>
          <GradientButton
            label={t('permissionPriming.denied.openSettings')}
            onPress={handleOpenSettingsPress}
            testID="permission-open-settings-cta"
          />
          <TouchableOpacity
            onPress={onHandled}
            style={styles.secondaryLink}
            testID="permission-proceed-anyway"
          >
            <Text style={styles.secondaryLinkLabel}>
              {t('permissionPriming.denied.proceedAnyway')}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textMuted,
    marginTop: spacing.md,
    textAlign: 'center',
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    paddingBottom: spacing['2xl'],
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
  },
  // Both escape hatches (priming's maybe-later, denied's proceed-anyway).
  // Deliberately NOT the reference design's muted green for this link: that
  // colour measures 3.14:1 on black and fails WCAG AA.
  secondaryLink: {
    alignItems: 'center',
    alignSelf: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
    minWidth: sizing.minTouchTarget,
  },
  secondaryLinkLabel: {
    ...typography.body,
    color: colors.textMuted,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
    marginTop: spacing.xl,
    textAlign: 'center',
  },
});

export default PermissionPrimingScreen;
