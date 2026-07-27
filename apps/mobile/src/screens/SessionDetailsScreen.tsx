import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { joinSession } from '../services/api-client';
import { radius, sizing, spacing, typography } from '../theme/tokens';

// Session Details (Screen 8): pre-join confirmation. This is where the
// actual POST /sessions/join call happens (not on the Scan screen) — so a
// mis-typed/expired/full/already-cancelled session surfaces its own
// specific error right where the user can act on it (retype the code, ask
// the host for a new one, etc.). Every join_session() outcome
// (sessions-store.ts's JoinOutcome on the server) maps to its own copy key
// here — never a single generic "join failed" message.
type SessionDetailsScreenProps = NativeStackScreenProps<RootStackParamList, 'SessionDetails'>;

const ERROR_KEYS: ReadonlySet<string> = new Set([
  'session_not_found',
  'session_not_joinable',
  'qr_token_expired',
  'session_at_capacity',
  'invalid_qr_token',
]);

const SessionDetailsScreen = ({ navigation, route }: SessionDetailsScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [joining, setJoining] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  const handleJoin = (): void => {
    setErrorKey(null);
    setJoining(true);
    joinSession(route.params.token)
      .then((result) => {
        setJoining(false);
        if (!result.ok) {
          setErrorKey(ERROR_KEYS.has(result.error.code) ? result.error.code : 'unknown');
          return;
        }
        navigation.navigate('ActiveSession', { sessionId: result.value.sessionId });
      })
      .catch(() => {
        setJoining(false);
        setErrorKey('unknown');
      });
  };

  return (
    <View style={styles.container} testID="session-details-screen">
      <View style={styles.content}>
        <Text style={styles.title}>{t('sessionDetails.title')}</Text>
        <Text style={styles.body}>{t('sessionDetails.body')}</Text>
        {errorKey !== null && (
          <Text style={styles.error} testID="session-details-error">
            {t(`sessionDetails.errors.${errorKey}`)}
          </Text>
        )}
      </View>
      <TouchableOpacity
        onPress={handleJoin}
        style={[styles.primaryCta, joining && styles.primaryCtaDisabled]}
        disabled={joining}
        testID="session-details-join"
      >
        <Text style={styles.primaryCtaLabel}>
          {joining ? t('sessionDetails.joining') : t('sessionDetails.join')}
        </Text>
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
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.md,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: '#222222',
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
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
});

export default SessionDetailsScreen;
