import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { createSession, listVenues } from '../services/api-client';
import type { DurationMode, SessionType, VenueResponse } from '../services/api-client';
import { useProfileStore } from '../state/profile-store';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// Create Session (Screen 5), DESIGN_GUIDELINES §0: an acquisition surface,
// full design effort. Mode + duration form -> POST /sessions -> navigates
// straight to Active Session (the host's own live view of the session they
// just created) — Session Details (Screen 8) is the PARTICIPANT'S pre-join
// confirmation, a different screen for a different role. All copy flows
// through t(); neutral grayscale only.
//
// Phase 6: static_qr is offered only when useProfileStore's role is
// verified_host/admin — venues are a strictly B2B construct. Choosing it
// requires picking one of the host's own venues (fetched here, not a
// separate screen — a small list, and the venue-management screen already
// owns venue creation).
type CreateSessionScreenProps = NativeStackScreenProps<RootStackParamList, 'CreateSession'>;

const DURATION_MODES: readonly DurationMode[] = ['fixed', 'open_ended'];

// Explicit map, not a ternary — a hardcoded two-way ternary silently
// mislabels any third option added to the type list without also being
// updated (exactly what happened when static_qr was added to the API
// contract but never to this screen back in Phase 2).
const TYPE_I18N_KEY: Record<SessionType, string> = {
  solo: 'solo',
  dynamic_qr: 'dynamicQr',
  static_qr: 'staticQr',
};

type VenuesLoadState =
  | { readonly status: 'idle' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly venues: readonly VenueResponse[] }
  | { readonly status: 'error' };

const CreateSessionScreen = ({ navigation }: CreateSessionScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const role = useProfileStore((state) => state.role);
  const isVerifiedHost = role === 'verified_host' || role === 'admin';
  const sessionTypes: readonly SessionType[] = isVerifiedHost
    ? ['solo', 'dynamic_qr', 'static_qr']
    : ['solo', 'dynamic_qr'];

  const [type, setType] = useState<SessionType>('solo');
  const [durationMode, setDurationMode] = useState<DurationMode>('fixed');
  const [minutesText, setMinutesText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [venuesLoad, setVenuesLoad] = useState<VenuesLoadState>({ status: 'idle' });
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);

  useEffect(() => {
    if (type !== 'static_qr' || venuesLoad.status !== 'idle') {
      return;
    }
    setVenuesLoad({ status: 'loading' });
    listVenues().then((result) => {
      if (!result.ok) {
        setVenuesLoad({ status: 'error' });
        return;
      }
      setVenuesLoad({ status: 'loaded', venues: result.value.venues });
    });
  }, [type, venuesLoad.status]);

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

    if (type === 'static_qr' && selectedVenueId === null) {
      setError(t('createSession.errors.venueRequired'));
      return;
    }

    setSubmitting(true);
    createSession({
      type,
      duration_mode: durationMode,
      ...(plannedDurationMinutes === undefined ? {} : { planned_duration_minutes: plannedDurationMinutes }),
      ...(selectedVenueId === null ? {} : { venue_id: selectedVenueId }),
    })
      .then((result) => {
        setSubmitting(false);
        if (!result.ok) {
          if (result.error.code === 'venue_not_owned') {
            setError(t('createSession.errors.venueNotOwned'));
            return;
          }
          if (result.error.code === 'venue_not_found') {
            setError(t('createSession.errors.venueNotFound'));
            return;
          }
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
        {sessionTypes.map((option) => (
          <TouchableOpacity
            key={option}
            onPress={() => {
              setType(option);
              if (option !== 'static_qr') {
                setSelectedVenueId(null);
              }
            }}
            style={[styles.toggle, type === option && styles.toggleSelected]}
            testID={`create-session-type-${option}`}
            accessibilityRole="radio"
            accessibilityState={{ selected: type === option }}
          >
            <Text style={[styles.toggleLabel, type === option && styles.toggleLabelSelected]}>
              {t(`createSession.type.${TYPE_I18N_KEY[option]}`)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {type === 'static_qr' && (
        <View testID="create-session-venue-picker">
          <Text style={styles.label}>{t('createSession.venuePicker.label')}</Text>
          {venuesLoad.status === 'loading' && (
            <Text style={styles.body}>{t('createSession.venuePicker.loading')}</Text>
          )}
          {venuesLoad.status === 'error' && (
            <Text style={styles.error}>{t('createSession.venuePicker.error')}</Text>
          )}
          {venuesLoad.status === 'loaded' && venuesLoad.venues.length === 0 && (
            <Text style={styles.body}>{t('createSession.venuePicker.empty')}</Text>
          )}
          {venuesLoad.status === 'loaded' &&
            venuesLoad.venues.map((venue) => (
              <TouchableOpacity
                key={venue.id}
                onPress={() => setSelectedVenueId(venue.id)}
                style={[styles.venueOption, selectedVenueId === venue.id && styles.venueOptionSelected]}
                testID={`create-session-venue-${venue.id}`}
                accessibilityRole="radio"
                accessibilityState={{ selected: selectedVenueId === venue.id }}
              >
                <Text
                  style={[
                    styles.venueOptionLabel,
                    selectedVenueId === venue.id && styles.venueOptionLabelSelected,
                  ]}
                >
                  {venue.name}
                </Text>
              </TouchableOpacity>
            ))}
        </View>
      )}

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
          placeholderTextColor={colors.placeholder}
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

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.sm,
  },
  container: {
    backgroundColor: colors.background,
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
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
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: colors.primary,
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
    color: colors.onPrimary,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
  toggle: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    flex: 1,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  toggleLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  toggleLabelSelected: {
    color: colors.onPrimary,
  },
  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  toggleSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  venueOption: {
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  venueOptionLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  venueOptionLabelSelected: {
    color: colors.onPrimary,
  },
  venueOptionSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
});

export default CreateSessionScreen;
