import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { createSession } from '../services/api-client';
import type { DurationMode, SessionType } from '../services/api-client';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Create Session (Screen 5), DESIGN_GUIDELINES §0: an acquisition surface,
// full design effort. Mode + duration form -> POST /sessions -> navigates
// straight to Active Session (the host's own live view of the session they
// just created) — Session Details (Screen 8) is the PARTICIPANT'S pre-join
// confirmation, a different screen for a different role. static_qr isn't
// offered here: it requires a venue, which has no creation UI yet (Phase 6
// B2B). All copy flows through t(); neutral grayscale only.
type CreateSessionScreenProps = NativeStackScreenProps<RootStackParamList, 'CreateSession'>;

const SESSION_TYPES: readonly SessionType[] = ['solo', 'dynamic_qr'];
const DURATION_MODES: readonly DurationMode[] = ['fixed', 'open_ended'];

const CreateSessionScreen = ({ navigation }: CreateSessionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [type, setType] = useState<SessionType>('solo');
  const [durationMode, setDurationMode] = useState<DurationMode>('fixed');
  const [minutesText, setMinutesText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (): void => {
    setError(null);

    let plannedDurationMinutes: number | undefined;
    if (durationMode === 'fixed') {
      const parsed = Number(minutesText);
      if (minutesText.trim() === '' || !Number.isInteger(parsed) || parsed <= 0) {
        setError(t('createSession.errors.minutesRequired'));
        return;
      }
      plannedDurationMinutes = parsed;
    }

    setSubmitting(true);
    createSession(
      plannedDurationMinutes === undefined
        ? { type, duration_mode: durationMode }
        : { type, duration_mode: durationMode, planned_duration_minutes: plannedDurationMinutes },
    )
      .then((result) => {
        setSubmitting(false);
        if (!result.ok) {
          setError(t('createSession.errors.requestFailed'));
          return;
        }
        navigation.navigate(
          'ActiveSession',
          result.value.qrToken === null
            ? { sessionId: result.value.id }
            : { sessionId: result.value.id, qrToken: result.value.qrToken },
        );
      })
      .catch(() => {
        setSubmitting(false);
        setError(t('createSession.errors.requestFailed'));
      });
  };

  return (
    <View style={styles.container} testID="create-session-screen">
      <Text style={styles.title}>{t('createSession.title')}</Text>

      <Text style={styles.label}>{t('createSession.type.label')}</Text>
      <View style={styles.toggleRow}>
        {SESSION_TYPES.map((option) => (
          <TouchableOpacity
            key={option}
            onPress={() => setType(option)}
            style={[styles.toggle, type === option && styles.toggleSelected]}
            testID={`create-session-type-${option}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === option }}
          >
            <Text style={[styles.toggleLabel, type === option && styles.toggleLabelSelected]}>
              {t(`createSession.type.${option === 'solo' ? 'solo' : 'dynamicQr'}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>{t('createSession.duration.label')}</Text>
      <View style={styles.toggleRow}>
        {DURATION_MODES.map((option) => (
          <TouchableOpacity
            key={option}
            onPress={() => setDurationMode(option)}
            style={[styles.toggle, durationMode === option && styles.toggleSelected]}
            testID={`create-session-duration-${option}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: durationMode === option }}
          >
            <Text style={[styles.toggleLabel, durationMode === option && styles.toggleLabelSelected]}>
              {t(`createSession.duration.${option === 'fixed' ? 'fixed' : 'openEnded'}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {durationMode === 'fixed' && (
        <TextInput
          style={styles.input}
          keyboardType="number-pad"
          placeholder={t('createSession.duration.minutesPlaceholder')}
          placeholderTextColor="#888888"
          value={minutesText}
          onChangeText={setMinutesText}
          testID="create-session-minutes-input"
        />
      )}

      {error !== null && (
        <Text style={styles.error} testID="create-session-error">
          {error}
        </Text>
      )}

      <TouchableOpacity
        onPress={handleSubmit}
        style={[styles.primaryCta, submitting && styles.primaryCtaDisabled]}
        disabled={submitting}
        testID="create-session-submit"
      >
        <Text style={styles.primaryCtaLabel}>{t('createSession.submit')}</Text>
      </TouchableOpacity>
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
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
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.lg,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing['2xl'],
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: '#FFFFFF',
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
  toggle: {
    alignItems: 'center',
    borderColor: '#CCCCCC',
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  toggleLabel: {
    ...typography.body,
    color: '#444444',
  },
  toggleLabelSelected: {
    color: '#FFFFFF',
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  toggleSelected: {
    backgroundColor: '#222222',
    borderColor: '#222222',
  },
});

export default CreateSessionScreen;
