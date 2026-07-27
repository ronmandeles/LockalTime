import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// QR Scan (Screen 7). Manual code entry IS the join flow for Phase 2, not a
// fallback (services/qr-scanner.ts explains why no camera dependency is
// added this phase). Continue only carries the raw token forward — the
// actual join API call happens on Session Details (8), the pre-join
// confirmation step, so a mis-typed code is caught there with a specific
// error rather than silently retried here.
type ScanSessionScreenProps = NativeStackScreenProps<RootStackParamList, 'ScanSession'>;

const ScanSessionScreen = ({ navigation }: ScanSessionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [tokenText, setTokenText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleContinue = (): void => {
    const token = tokenText.trim();
    if (token === '') {
      setError(t('scanSession.errors.tokenRequired'));
      return;
    }
    setError(null);
    navigation.navigate('SessionDetails', { token });
  };

  return (
    <View style={styles.container} testID="scan-session-screen">
      <Text style={styles.title}>{t('scanSession.title')}</Text>
      <Text style={styles.body}>{t('scanSession.body')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('scanSession.tokenPlaceholder')}
        placeholderTextColor="#888888"
        value={tokenText}
        onChangeText={setTokenText}
        autoCapitalize="none"
        autoCorrect={false}
        testID="scan-session-token-input"
      />

      {error !== null && (
        <Text style={styles.error} testID="scan-session-error">
          {error}
        </Text>
      )}

      <TouchableOpacity onPress={handleContinue} style={styles.primaryCta} testID="scan-session-continue">
        <Text style={styles.primaryCtaLabel}>{t('scanSession.continue')}</Text>
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
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    borderColor: '#CCCCCC',
    borderRadius: radius.md,
    borderWidth: 1,
    color: '#222222',
    height: sizing.inputHeight,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing['2xl'],
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

export default ScanSessionScreen;
