import React, { useRef, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { leaveSession } from '../services/api-client';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Emergency Exit (Screen 9), DESIGN_GUIDELINES §0: an in-session surface —
// deliberately quiet, no stimulation beyond what's functionally necessary.
// §7: this one high-stakes/irreversible action gets a deliberately slower,
// effortful hold-to-confirm interaction, not a tap — motion communicates
// weight. Held state uses a plain style toggle rather than Animated.timing:
// a smooth fill is decorative polish, and JS-driven Animated timing fights
// with the fake timers this screen's confirmation logic needs to be
// reliably testable under (RAF-driven updates racing an explicit
// act()-wrapped timer advance produces overlapping act() scopes) — a real
// interaction hazard worth avoiding, not just a test inconvenience.
type EmergencyExitScreenProps = NativeStackScreenProps<RootStackParamList, 'EmergencyExit'>;

const HOLD_DURATION_MS = 1500;

const EmergencyExitScreen = ({ route, navigation }: EmergencyExitScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const [exiting, setExiting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const clearHold = (): void => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  };

  const handleConfirmed = async (): Promise<void> => {
    setExiting(true);
    const result = await leaveSession(route.params.sessionId, 'emergency_exit');
    if (!result.ok) {
      setExiting(false);
      setHolding(false);
      setError(t('emergencyExit.errors.requestFailed'));
      return;
    }
    navigation.reset({
      index: 0,
      routes: [{ name: 'SessionCompletion', params: { sessionId: route.params.sessionId } }],
    });
  };

  const handlePressIn = (): void => {
    if (exiting) {
      return;
    }
    setError(null);
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      handleConfirmed().catch(() => undefined);
    }, HOLD_DURATION_MS);
  };

  const handlePressOut = (): void => {
    if (exiting) {
      return;
    }
    clearHold();
  };

  const handleCancel = (): void => {
    navigation.goBack();
  };

  return (
    <View style={styles.container} testID="emergency-exit-screen">
      <Text style={styles.title}>{t('emergencyExit.title')}</Text>
      <Text style={styles.body}>{t('emergencyExit.body')}</Text>

      {error !== null && (
        <Text style={styles.error} testID="emergency-exit-error">
          {error}
        </Text>
      )}

      <TouchableOpacity
        style={[styles.holdButton, holding && styles.holdButtonActive]}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={exiting}
        testID="emergency-exit-hold"
        accessibilityRole="button"
        accessibilityLabel={t('emergencyExit.holdToExit')}
      >
        <Text style={styles.holdLabel}>{t('emergencyExit.holdToExit')}</Text>
      </TouchableOpacity>

      <TouchableOpacity onPress={handleCancel} testID="emergency-exit-cancel" disabled={exiting}>
        <Text style={styles.cancelLabel}>{t('emergencyExit.cancel')}</Text>
      </TouchableOpacity>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
// In-session surface: no elevation, no bright accents.
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: '#444444',
    marginTop: spacing.sm,
  },
  cancelLabel: {
    ...typography.body,
    color: '#666666',
    marginTop: spacing.lg,
    minHeight: sizing.minTouchTarget,
    textAlign: 'center',
    textAlignVertical: 'center',
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    justifyContent: 'center',
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.md,
  },
  holdButton: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  holdButtonActive: {
    backgroundColor: '#DDDDDD',
  },
  holdLabel: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
});

export default EmergencyExitScreen;
