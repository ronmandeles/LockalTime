import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Home (Screen 4), real data wired in Phase 2 task 2.7: DESIGN_GUIDELINES
// §1's reference model — one clear primary action, here two entry points
// side by side (create vs. join), not three competing CTAs. No session-
// lookup on mount: "does this user have an active session" needs its own
// endpoint/decision not yet made (see backlog's known-gaps list) — Screen
// 13 (Welcome Back / interrupted session) is the explicit, separate,
// not-yet-built home for that. All copy flows through t(); neutral
// grayscale only — the color palette is intentionally deferred.
type HomeScreenProps = NativeStackScreenProps<RootStackParamList, 'Home'>;

const HomeScreen = ({ navigation }: HomeScreenProps): React.JSX.Element => {
  const { t } = useTranslation();

  return (
    <View style={styles.container} testID="home-screen">
      <Text style={styles.title}>{t('home.title')}</Text>
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
    justifyContent: 'center',
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
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
  title: {
    ...typography.display,
    color: '#222222',
    marginBottom: spacing['2xl'],
    textAlign: 'center',
  },
});

export default HomeScreen;
