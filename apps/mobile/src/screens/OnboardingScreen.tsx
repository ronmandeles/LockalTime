import React from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';

import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import GradientButton from '../components/GradientButton';
import LogoMark from '../components/LogoMark';
import { colors, sizing, spacing, typography } from '../theme/tokens';

// Welcome screen (Screen 1), DESIGN_GUIDELINES §9: a single page — hero mark,
// headline, one line of body copy, and one primary CTA pinned to the bottom.
// It replaced a three-page carousel; the owner's call was that a first
// impression should be one clear statement rather than three swipes, and the
// two dropped pages' copy was removed from both locale bundles rather than
// left orphaned.
//
// The screen is completion-agnostic: it only fires onComplete, and there is
// now exactly one way to do that (the CTA — the skip link is gone). The App
// gate still owns what completion means. All copy flows through t()
// (placeholder, flagged in the locale bundles); styling is token-based and
// direction-neutral per .claude/skills/i18n/SKILL.md.

// The hero is the one element in the stack that can give. On a 320x568pt
// phone with OS large-font settings, a hero fixed at the 160pt token pushes
// the bottom-pinned CTA off-screen; a ScrollView would fight that pinning, so
// the mark is capped against window height instead. On any modern phone this
// resolves to the full token.
const HERO_MAX_WINDOW_HEIGHT_FRACTION = 0.25;

interface OnboardingScreenProps {
  readonly onComplete: () => void;
}

const OnboardingScreen = ({ onComplete }: OnboardingScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const { height: windowHeight } = useWindowDimensions();

  const heroSize = Math.min(
    sizing.heroLogo,
    Math.round(windowHeight * HERO_MAX_WINDOW_HEIGHT_FRACTION),
  );

  return (
    <SafeAreaView style={styles.container} testID="onboarding-screen">
      <View style={styles.content}>
        <LogoMark size={heroSize} testID="onboarding-hero-logo" />
        <Text style={styles.title}>{t('onboarding.title')}</Text>
        <Text style={styles.body}>{t('onboarding.body')}</Text>
      </View>
      <GradientButton
        label={t('onboarding.getStarted')}
        onPress={onComplete}
        style={styles.primaryCta}
        testID="onboarding-primary-cta"
      />
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
  },
  content: {
    alignItems: 'center',
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: spacing.xl,
  },
  primaryCta: {
    marginBottom: spacing['2xl'],
    marginEnd: spacing.md,
    marginStart: spacing.md,
  },
  title: {
    ...typography.displayLarge,
    color: colors.textPrimary,
    marginTop: spacing['2xl'],
    textAlign: 'center',
  },
});

export default OnboardingScreen;
