import React, { useRef, useState } from 'react';
import { Linking, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { API_BASE_URL } from '../config/api-config';
import { deleteAccount } from '../services/api-client';
import { signOut } from '../services/auth-service';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Settings (Phase 7, Release Prep) — the app's first settings/account
// surface. Two responsibilities: sign-out (auth-service's signOut() has
// existed since Phase 1, but this is the first screen to ever call it —
// there was previously no UI path to it at all) and the App/Play Store-
// mandated account deletion path (guideline 5.1.1v). Deletion reuses
// EmergencyExitScreen's hold-to-confirm interaction (DESIGN_GUIDELINES §7:
// an irreversible action gets a slower, effortful interaction, not a tap) —
// this is the app's most irreversible action yet.
const HOLD_DURATION_MS = 1500;

const SettingsScreen = (): React.JSX.Element => {
  const { t } = useTranslation();
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [holding, setHolding] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async (): Promise<void> => {
    setSignOutError(null);
    const result = await signOut();
    if (!result.ok) {
      setSignOutError(t('settings.signOutError'));
    }
    // On success there is nothing else to do here: attachAuthStateListener
    // (App.tsx) reacts to the SIGNED_OUT event and swaps the whole
    // navigator away from under this screen.
  };

  const clearHold = (): void => {
    if (holdTimer.current !== null) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
    setHolding(false);
  };

  const handleDeleteConfirmed = async (): Promise<void> => {
    setDeleting(true);
    const result = await deleteAccount();
    if (!result.ok) {
      setDeleting(false);
      setHolding(false);
      setDeleteError(t('settings.deleteAccount.error'));
      return;
    }
    // The account is gone server-side; sign out locally so the stored
    // session is cleared and the SIGNED_OUT event swaps the app back to
    // AuthScreen, same as handleSignOut above.
    await signOut();
  };

  const handleDeletePressIn = (): void => {
    if (deleting) {
      return;
    }
    setDeleteError(null);
    setHolding(true);
    holdTimer.current = setTimeout(() => {
      holdTimer.current = null;
      handleDeleteConfirmed().catch(() => undefined);
    }, HOLD_DURATION_MS);
  };

  const handleDeletePressOut = (): void => {
    if (deleting) {
      return;
    }
    clearHold();
  };

  return (
    <View style={styles.container} testID="settings-screen">
      <Text style={styles.title}>{t('settings.title')}</Text>

      <TouchableOpacity
        onPress={() => {
          handleSignOut().catch(() => undefined);
        }}
        style={styles.row}
        testID="settings-sign-out"
      >
        <Text style={styles.rowLabel}>{t('settings.signOut')}</Text>
      </TouchableOpacity>
      {signOutError !== null && (
        <Text style={styles.error} testID="settings-sign-out-error">
          {signOutError}
        </Text>
      )}

      <Text style={styles.sectionTitle}>{t('settings.legal.title')}</Text>
      <TouchableOpacity
        onPress={() => {
          Linking.openURL(`${API_BASE_URL}/legal/terms`).catch(() => undefined);
        }}
        style={styles.row}
        testID="settings-terms-link"
      >
        <Text style={styles.rowLabel}>{t('settings.legal.termsOfService')}</Text>
      </TouchableOpacity>
      <TouchableOpacity
        onPress={() => {
          Linking.openURL(`${API_BASE_URL}/legal/privacy`).catch(() => undefined);
        }}
        style={styles.row}
        testID="settings-privacy-link"
      >
        <Text style={styles.rowLabel}>{t('settings.legal.privacyPolicy')}</Text>
      </TouchableOpacity>

      <View style={styles.dangerZone}>
        <Text style={styles.dangerTitle}>{t('settings.deleteAccount.title')}</Text>
        <Text style={styles.dangerBody}>{t('settings.deleteAccount.body')}</Text>

        {deleteError !== null && (
          <Text style={styles.error} testID="settings-delete-error">
            {deleteError}
          </Text>
        )}

        <TouchableOpacity
          style={[styles.holdButton, holding && styles.holdButtonActive]}
          onPressIn={handleDeletePressIn}
          onPressOut={handleDeletePressOut}
          disabled={deleting}
          testID="settings-delete-hold"
          accessibilityRole="button"
          accessibilityLabel={t('settings.deleteAccount.holdToDelete')}
        >
          <Text style={styles.holdLabel}>{t('settings.deleteAccount.holdToDelete')}</Text>
        </TouchableOpacity>
      </View>
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
    paddingTop: spacing['2xl'],
  },
  dangerBody: {
    ...typography.body,
    color: '#666666',
    marginTop: spacing.xs,
  },
  dangerTitle: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  dangerZone: {
    borderColor: '#E0E0E0',
    borderRadius: radius.md,
    borderTopWidth: 1,
    marginTop: spacing['2xl'],
    paddingTop: spacing.lg,
  },
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.xs,
  },
  holdButton: {
    alignItems: 'center',
    backgroundColor: '#F5F5F5',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  holdButtonActive: {
    backgroundColor: '#DDDDDD',
  },
  holdLabel: {
    ...typography.bodyStrong,
    color: '#222222',
  },
  row: {
    marginTop: spacing.lg,
    minHeight: sizing.minTouchTarget,
    justifyContent: 'center',
  },
  rowLabel: {
    ...typography.body,
    color: '#222222',
  },
  sectionTitle: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing['2xl'],
  },
  title: {
    ...typography.heading,
    color: '#222222',
    marginBottom: spacing.lg,
  },
});

export default SettingsScreen;
