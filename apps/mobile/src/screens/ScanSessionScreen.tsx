import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';
import { useCameraPermission } from 'react-native-vision-camera';

import QrCodeCamera from '../components/QrCodeCamera';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// QR Scan (Screen 7). Phase 3 task 3.5 wires the real camera (deferred from
// Phase 2 — docs/MANUAL_QA.md — until native Pod/Gradle linking work was
// already in flight this phase). Camera mode is the default once permission
// is granted; manual entry is always reachable, never a dead-end fallback
// (same "commitment device, not a jail" posture as blocking-permissions.ts)
// — a user can always switch back, and a denied/undetermined camera
// permission simply keeps them on manual entry. Continue and a successful
// scan both hand the raw token to Session Details (8), which owns the
// actual join API call, so a mis-typed/misread code is caught there with a
// specific error rather than silently retried here.
type ScanSessionScreenProps = NativeStackScreenProps<RootStackParamList, 'ScanSession'>;
type ScanMode = 'camera' | 'manual';

const ScanSessionScreen = ({ navigation }: ScanSessionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const { hasPermission, requestPermission } = useCameraPermission();
  const [mode, setMode] = useState<ScanMode>(hasPermission ? 'camera' : 'manual');
  const [tokenText, setTokenText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const goToSessionDetails = (token: string): void => {
    navigation.navigate('SessionDetails', { token });
  };

  const handleContinue = (): void => {
    const token = tokenText.trim();
    if (token === '') {
      setError(t('scanSession.errors.tokenRequired'));
      return;
    }
    setError(null);
    goToSessionDetails(token);
  };

  const handleScanned = (value: string): void => {
    const token = value.trim();
    if (token === '') {
      // An unreadable/blank decode — stay on camera and keep scanning
      // rather than forwarding nothing to Session Details.
      return;
    }
    goToSessionDetails(token);
  };

  const handleScanWithCameraPress = (): void => {
    if (hasPermission) {
      setMode('camera');
      return;
    }
    requestPermission().then((granted) => {
      if (granted) {
        setMode('camera');
      }
      // Denied/dismissed: stay on manual entry, which always works
      // regardless of camera permission.
    });
  };

  if (mode === 'camera') {
    return (
      <View style={styles.cameraContainer} testID="scan-session-screen">
        <QrCodeCamera onScanned={handleScanned} />
        <TouchableOpacity
          onPress={() => setMode('manual')}
          style={styles.enterManuallyLink}
          testID="scan-session-enter-manually"
        >
          <Text style={styles.enterManuallyLabel}>{t('scanSession.enterManually')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container} testID="scan-session-screen">
      <Text style={styles.title}>{t('scanSession.title')}</Text>
      <Text style={styles.body}>{t('scanSession.body')}</Text>

      <TextInput
        style={styles.input}
        placeholder={t('scanSession.tokenPlaceholder')}
        placeholderTextColor={colors.placeholder}
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

      <View style={styles.cameraSwitch}>
        {!hasPermission && <Text style={styles.cameraSwitchBody}>{t('scanSession.cameraPermission.body')}</Text>}
        <TouchableOpacity onPress={handleScanWithCameraPress} testID="scan-session-scan-with-camera">
          <Text style={styles.cameraSwitchLabel}>
            {hasPermission ? t('scanSession.scanWithCamera') : t('scanSession.cameraPermission.allow')}
          </Text>
        </TouchableOpacity>
      </View>
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
  cameraContainer: {
    backgroundColor: colors.black,
    flex: 1,
  },
  cameraSwitch: {
    alignItems: 'center',
    marginTop: spacing.xl,
  },
  cameraSwitchBody: {
    ...typography.caption,
    color: colors.textMuted,
    marginBottom: spacing.sm,
    textAlign: 'center',
  },
  cameraSwitchLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  enterManuallyLabel: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
  enterManuallyLink: {
    alignItems: 'center',
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    borderRadius: radius.md,
    bottom: spacing.xl,
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    position: 'absolute',
  },
  error: {
    ...typography.caption,
    color: colors.danger,
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.textPrimary,
    height: sizing.inputHeight,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
});

export default ScanSessionScreen;
