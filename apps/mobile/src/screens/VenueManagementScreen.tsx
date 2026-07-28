import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { createVenue, listVenues, regenerateVenueQr } from '../services/api-client';
import type { VenueResponse } from '../services/api-client';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Venue management (Phase 6, B2B) — reachable only from Home's
// manageVenuesCta link, itself gated on useProfileStore's role. The server
// re-enforces the same gate (requireRole) regardless, so nothing here
// needs to defensively re-check role — a stray non-host reaching this
// screen just sees every request fail with insufficient_role, same as any
// other screen's generic error state.
//
// The venue's qrToken is rendered as plain text, not a generated QR image
// — no QR-rendering library exists in this codebase yet (ActiveSessionScreen's
// existing dynamic_qr card carries the same limitation). A business copies
// this string into whatever they print, same posture as the rest of the app.
type VenueManagementScreenProps = NativeStackScreenProps<RootStackParamList, 'VenueManagement'>;

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly venues: readonly VenueResponse[] }
  | { readonly status: 'error' };

const VenueManagementScreen = (_props: VenueManagementScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  const [name, setName] = useState('');
  const [addressLabel, setAddressLabel] = useState('');
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [confirmingRegenerateId, setConfirmingRegenerateId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [regenerateSuccessId, setRegenerateSuccessId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });

    listVenues().then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoad({ status: 'error' });
        return;
      }
      setLoad({ status: 'loaded', venues: result.value.venues });
    });

    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

  const handleAddVenue = (): void => {
    setAddError(null);
    if (name.trim() === '') {
      setAddError(t('venueManagement.errors.nameRequired'));
      return;
    }

    setAdding(true);
    createVenue(
      addressLabel.trim() === '' ? { name: name.trim() } : { name: name.trim(), address_label: addressLabel.trim() },
    )
      .then((result) => {
        setAdding(false);
        if (!result.ok) {
          setAddError(t('venueManagement.errors.requestFailed'));
          return;
        }
        setName('');
        setAddressLabel('');
        setReloadToken((token) => token + 1);
      })
      .catch(() => {
        setAdding(false);
        setAddError(t('venueManagement.errors.requestFailed'));
      });
  };

  const handleRegenerate = (venueId: string): void => {
    setRegenerateError(null);
    setRegenerateSuccessId(null);
    setRegeneratingId(venueId);
    regenerateVenueQr(venueId)
      .then((result) => {
        setRegeneratingId(null);
        setConfirmingRegenerateId(null);
        if (!result.ok) {
          setRegenerateError(t('venueManagement.regenerateError'));
          return;
        }
        setRegenerateSuccessId(venueId);
        setReloadToken((token) => token + 1);
      })
      .catch(() => {
        setRegeneratingId(null);
        setConfirmingRegenerateId(null);
        setRegenerateError(t('venueManagement.regenerateError'));
      });
  };

  return (
    <View style={styles.container} testID="venue-management-screen">
      <Text style={styles.title}>{t('venueManagement.title')}</Text>

      {load.status === 'loading' && (
        <Text style={styles.body} testID="venue-management-loading">
          {t('venueManagement.title')}
        </Text>
      )}

      {load.status === 'error' && (
        <View>
          <Text style={styles.error} testID="venue-management-load-error">
            {t('venueManagement.loadError')}
          </Text>
          <TouchableOpacity
            onPress={() => setReloadToken((token) => token + 1)}
            testID="venue-management-retry"
          >
            <Text style={styles.retryLabel}>{t('venueManagement.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {load.status === 'loaded' && load.venues.length === 0 && (
        <Text style={styles.body} testID="venue-management-empty">
          {t('venueManagement.empty')}
        </Text>
      )}

      {load.status === 'loaded' &&
        load.venues.map((venue) => (
          <View key={venue.id} style={styles.venueCard} testID={`venue-card-${venue.id}`}>
            <Text style={styles.venueName}>{venue.name}</Text>
            {venue.addressLabel !== null && <Text style={styles.venueAddress}>{venue.addressLabel}</Text>}

            <Text style={styles.qrLabel}>{t('venueManagement.qrLabel')}</Text>
            <Text style={styles.qrValue} testID={`venue-qr-${venue.id}`}>
              {venue.qrToken}
            </Text>

            {regenerateSuccessId === venue.id && (
              <Text style={styles.successText}>{t('venueManagement.regenerateSuccess')}</Text>
            )}
            {regenerateError !== null && regeneratingId === null && confirmingRegenerateId === null && (
              <Text style={styles.error}>{regenerateError}</Text>
            )}

            {confirmingRegenerateId === venue.id ? (
              <View>
                <Text style={styles.confirmTitle}>{t('venueManagement.regenerateConfirmTitle')}</Text>
                <Text style={styles.confirmBody}>{t('venueManagement.regenerateConfirmBody')}</Text>
                <View style={styles.confirmRow}>
                  <TouchableOpacity
                    onPress={() => setConfirmingRegenerateId(null)}
                    testID={`venue-regenerate-cancel-${venue.id}`}
                  >
                    <Text style={styles.confirmCancelLabel}>{t('venueManagement.regenerateCancel')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    onPress={() => handleRegenerate(venue.id)}
                    disabled={regeneratingId === venue.id}
                    testID={`venue-regenerate-confirm-${venue.id}`}
                  >
                    <Text style={styles.confirmActionLabel}>{t('venueManagement.regenerateConfirm')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ) : (
              <TouchableOpacity
                onPress={() => setConfirmingRegenerateId(venue.id)}
                testID={`venue-regenerate-${venue.id}`}
              >
                <Text style={styles.regenerateLabel}>{t('venueManagement.regenerate')}</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

      <View style={styles.form}>
        <Text style={styles.label}>{t('venueManagement.nameLabel')}</Text>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder={t('venueManagement.namePlaceholder')}
          placeholderTextColor="#888888"
          testID="venue-management-name-input"
        />

        <Text style={styles.label}>{t('venueManagement.addressLabel')}</Text>
        <TextInput
          style={styles.input}
          value={addressLabel}
          onChangeText={setAddressLabel}
          placeholder={t('venueManagement.addressPlaceholder')}
          placeholderTextColor="#888888"
          testID="venue-management-address-input"
        />

        {addError !== null && (
          <Text style={styles.error} testID="venue-management-add-error">
            {addError}
          </Text>
        )}

        <TouchableOpacity
          onPress={handleAddVenue}
          style={[styles.primaryCta, adding && styles.primaryCtaDisabled]}
          disabled={adding}
          testID="venue-management-add-submit"
        >
          <Text style={styles.primaryCtaLabel}>{t('venueManagement.addVenue')}</Text>
        </TouchableOpacity>
      </View>
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
  confirmActionLabel: {
    ...typography.bodyStrong,
    color: '#B00020',
    minHeight: sizing.minTouchTarget,
  },
  confirmBody: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  confirmCancelLabel: {
    ...typography.bodyStrong,
    color: '#666666',
    minHeight: sizing.minTouchTarget,
  },
  confirmRow: {
    flexDirection: 'row',
    gap: spacing.lg,
    marginTop: spacing.sm,
  },
  confirmTitle: {
    ...typography.bodyStrong,
    color: '#222222',
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
  form: {
    marginTop: spacing['2xl'],
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
    marginTop: spacing.lg,
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: '#FFFFFF',
  },
  qrLabel: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.sm,
  },
  qrValue: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.xs,
  },
  regenerateLabel: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
  retryLabel: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.sm,
  },
  successText: {
    ...typography.caption,
    color: '#222222',
    marginTop: spacing.xs,
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
  venueAddress: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  venueCard: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.lg,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  venueName: {
    ...typography.bodyStrong,
    color: '#222222',
  },
});

export default VenueManagementScreen;
