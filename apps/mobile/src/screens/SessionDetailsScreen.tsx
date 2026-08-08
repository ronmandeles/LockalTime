import React, { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { BlockedCategory } from '../config/blocked-categories';
import type { RootStackParamList } from '../navigation/types';
import { joinSession, joinVenueSession, previewSession, rejoinSession } from '../services/api-client';
import { describeBlocklist } from '../services/blocklist-display';
import { prepareIosBlocklistSelection } from '../services/ios-family-controls';
import { fetchOpenPresenceIntervals, fetchSession } from '../services/session-repository';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// Session Details (Screen 8): pre-join confirmation. This is where the
// actual POST /sessions/join call happens (not on the Scan screen) — so a
// mis-typed/expired/full/already-cancelled session surfaces its own
// specific error right where the user can act on it. Every join_session()
// outcome (sessions-store.ts's JoinOutcome on the server) maps to its own
// copy key here — never a single generic "join failed" message.
//
// Also doubles as Screen 13's rejoin confirmation (Phase 4 task 12,
// ARCHITECTURE.md §2 item 13): route.params carries either a scanned QR
// `token` (normal join) or a bare `sessionId` (Welcome Back's token-free
// rejoin) — never both, RootStackParamList models them as a discriminated
// union. Same screen, same CTA shape, only the copy and which api-client
// call fires differ.
//
// Phase 6 task 7: real details before joining, via previewSession() (join
// mode — is_session_participant()'s RLS denies a non-participant a direct
// read, so this has to hit the Node preview endpoint) or a direct
// RLS-protected read (rejoin mode — the caller already IS a participant,
// same reasoning as WelcomeBackScreen's own read). The preview is
// informational only: its failure never blocks the Join CTA, since the
// actual join call already has its own complete error handling.
type SessionDetailsScreenProps = NativeStackScreenProps<RootStackParamList, 'SessionDetails'>;

const ERROR_KEYS: ReadonlySet<string> = new Set([
  'session_not_found',
  'session_not_joinable',
  'qr_token_expired',
  'session_at_capacity',
  'invalid_qr_token',
  'not_a_prior_participant',
  'venue_not_found',
  'no_active_session_at_venue',
  'selection_cancelled',
]);

// Which recovery action a given join failure gets — DESIGN_GUIDELINES-
// consistent grouping (three real needs: "the code you have is dead, get a
// new one", "this session isn't reachable at all, leave", "something
// transient happened, try the same thing again").
const SCAN_AGAIN_CODES: ReadonlySet<string> = new Set([
  'qr_token_expired',
  'invalid_qr_token',
  'no_active_session_at_venue',
]);
const BACK_TO_HOME_CODES: ReadonlySet<string> = new Set([
  'session_not_found',
  'session_not_joinable',
  'session_at_capacity',
  'not_a_prior_participant',
  'venue_not_found',
]);

interface DetailsView {
  readonly elapsedMinutes: number | null;
  readonly participantCount: number;
  readonly venueName: string | null;
  // Late-join note: join mode shows it only once the completion bonus is
  // actually out of reach (server-computed); rejoin mode always shows it —
  // reaching Welcome Back's rejoin already means a prior disconnect, and
  // ARCHITECTURE.md §7 forfeits the completion bonus unconditionally for
  // any gap, so there is nothing left to compute.
  readonly showCompletionBonusNote: boolean;
  // Phase 9: names only, resolved to display text on THIS device — nothing
  // a host typed ever travels (plan §6).
  readonly blockedCategories: readonly BlockedCategory[];
  readonly blockedPackages: readonly string[];
}

type PreviewLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly details: DetailsView }
  | { readonly status: 'error' };

const SessionDetailsScreen = ({ navigation, route }: SessionDetailsScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [joining, setJoining] = useState(false);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const [previewLoad, setPreviewLoad] = useState<PreviewLoadState>({ status: 'loading' });
  const [reloadToken, setReloadToken] = useState(0);
  // Only meaningful in join mode — which endpoint the Join CTA calls,
  // resolved by previewSession()'s tokenKind (the printed venue QR needs
  // /sessions/join-venue, a normal session QR needs /sessions/join).
  const [joinsViaVenue, setJoinsViaVenue] = useState(false);
  const isRejoin = !('token' in route.params);

  useEffect(() => {
    let cancelled = false;
    setPreviewLoad({ status: 'loading' });

    if (isRejoin) {
      const sessionId = route.params.sessionId;
      Promise.all([fetchSession(sessionId), fetchOpenPresenceIntervals(sessionId)]).then(
        ([sessionResult, intervalsResult]) => {
          if (cancelled) {
            return;
          }
          if (!sessionResult.ok) {
            setPreviewLoad({ status: 'error' });
            return;
          }
          const elapsedMinutes =
            sessionResult.value.started_at !== null
              ? Math.max(
                  0,
                  Math.floor((Date.now() - new Date(sessionResult.value.started_at).getTime()) / 60_000),
                )
              : null;
          setPreviewLoad({
            status: 'loaded',
            details: {
              elapsedMinutes,
              participantCount: intervalsResult.ok ? intervalsResult.value.length : 0,
              venueName: null,
              showCompletionBonusNote: true,
              blockedCategories: sessionResult.value.blocked_categories,
              blockedPackages: sessionResult.value.blocked_packages,
            },
          });
        },
      );
    } else {
      const token = route.params.token;
      previewSession(token).then((result) => {
        if (cancelled) {
          return;
        }
        if (!result.ok) {
          setPreviewLoad({ status: 'error' });
          return;
        }
        setJoinsViaVenue(result.value.tokenKind === 'venue');
        setPreviewLoad({
          status: 'loaded',
          details: {
            elapsedMinutes: result.value.elapsedMinutes,
            participantCount: result.value.participantCount,
            venueName: result.value.venueName,
            showCompletionBonusNote:
              result.value.elapsedMinutes !== null &&
              result.value.elapsedMinutes > 0 &&
              !result.value.completionBonusAvailable,
            blockedCategories: result.value.blockedCategories,
            blockedPackages: result.value.blockedPackages,
          },
        });
      });
    }

    return () => {
      cancelled = true;
    };
    // route.params is a discriminated union (token XOR sessionId) — safe to
    // depend on the whole object since a real param change always means a
    // genuinely different screen instance in practice (a fresh scan/rejoin).
  }, [isRejoin, route.params, reloadToken]);

  const details = previewLoad.status === 'loaded' ? previewLoad.details : null;
  const blocklistLabels =
    details === null
      ? []
      : describeBlocklist(details.blockedCategories, details.blockedPackages, (category) =>
          t(`createSession.blocklist.category.${category}` as never),
        );

  const handleJoin = (): void => {
    setErrorKey(null);
    setJoining(true);

    // Phase 9 (plan §7): on iOS this device has to acquire its own tokens
    // before it can enforce anything, which may mean Apple's picker.
    //
    // It runs BEFORE the join call, deliberately. Cancelling must leave the
    // member not joined at all — a join that succeeded followed by a
    // dismissed picker is precisely the half-joined state the plan forbids:
    // present in the session, enforcing nothing, still earning. The cost is
    // that a picker completed just before a full session was wasted effort,
    // which is the better of the two failures.
    //
    // Resolves 'not_applicable' immediately on Android, which resolves every
    // name locally and needs nothing.
    prepareIosBlocklistSelection({
      categories: details?.blockedCategories ?? [],
      packages: details?.blockedPackages ?? [],
      headerText: `${t('sessionDetails.blocklist.pickerHeader')}\n${blocklistLabels.join(', ')}`,
      footerText: t('sessionDetails.blocklist.pickerFooter'),
    })
      .then((outcome) => {
        if (outcome === 'cancelled') {
          setJoining(false);
          setErrorKey('selection_cancelled');
          return undefined;
        }
        return isRejoin
          ? rejoinSession(route.params.sessionId)
          : joinsViaVenue
            ? joinVenueSession(route.params.token)
            : joinSession(route.params.token);
      })
      .then((result) => {
        if (result === undefined) {
          return;
        }
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

  const handleRecoveryAction = (): void => {
    if (errorKey !== null && SCAN_AGAIN_CODES.has(errorKey)) {
      navigation.navigate('ScanSession');
      return;
    }
    if (errorKey !== null && BACK_TO_HOME_CODES.has(errorKey)) {
      navigation.navigate('Home');
      return;
    }
    // Anything else (network_error/unauthenticated/unknown_error/unknown)
    // is a transient failure — re-attempt the same join.
    handleJoin();
  };

  const recoveryLabel =
    errorKey !== null && SCAN_AGAIN_CODES.has(errorKey)
      ? t('sessionDetails.recovery.scanAgain')
      : errorKey !== null && BACK_TO_HOME_CODES.has(errorKey)
        ? t('sessionDetails.recovery.backToHome')
        : t('sessionDetails.recovery.retry');

  return (
    <View style={styles.container} testID="session-details-screen">
      <View style={styles.content}>
        <Text style={styles.title}>{t(isRejoin ? 'sessionDetails.rejoinTitle' : 'sessionDetails.title')}</Text>
        <Text style={styles.body}>{t(isRejoin ? 'sessionDetails.rejoinBody' : 'sessionDetails.body')}</Text>

        {previewLoad.status === 'loading' && (
          <Text style={styles.previewText} testID="session-details-preview-loading">
            {t('sessionDetails.preview.loading')}
          </Text>
        )}

        {previewLoad.status === 'error' && (
          <View>
            <Text style={styles.error} testID="session-details-preview-error">
              {t('sessionDetails.preview.error')}
            </Text>
            <TouchableOpacity
              onPress={() => setReloadToken((token) => token + 1)}
              testID="session-details-preview-retry"
            >
              <Text style={styles.retryLabel}>{t('sessionDetails.preview.retry')}</Text>
            </TouchableOpacity>
          </View>
        )}

        {previewLoad.status === 'loaded' && (
          <View testID="session-details-preview">
            {previewLoad.details.venueName !== null && (
              <Text style={styles.previewText} testID="session-details-venue-name">
                {t('sessionDetails.preview.atVenue', { name: previewLoad.details.venueName })}
              </Text>
            )}
            {previewLoad.details.elapsedMinutes !== null && previewLoad.details.elapsedMinutes > 0 && (
              <Text style={styles.previewText} testID="session-details-elapsed">
                {t('sessionDetails.preview.elapsedMinutes', { count: previewLoad.details.elapsedMinutes })}
              </Text>
            )}
            <Text style={styles.previewText} testID="session-details-participant-count">
              {t('sessionDetails.preview.participantCount', {
                count: previewLoad.details.participantCount,
              })}
            </Text>
            {previewLoad.details.showCompletionBonusNote && (
              <Text style={styles.completionBonusNote} testID="session-details-completion-bonus-note">
                {t('sessionDetails.completionBonusUnavailable')}
              </Text>
            )}

            {/* Phase 9: what joining costs you, before you join. On iOS this
                is also what the member works from inside Apple's own sheet,
                so it is part of the join flow rather than decoration. Each
                name is its own Text node — they are Latin brand names that
                sit inside Hebrew copy, and interpolating them into a
                sentence lets the bidi algorithm reorder the punctuation
                around them (i18n skill). */}
            {blocklistLabels.length > 0 && (
              <View testID="session-details-blocklist">
                <Text style={styles.blocklistLabel}>{t('sessionDetails.blocklist.label')}</Text>
                {blocklistLabels.map((label) => (
                  <Text key={label} style={styles.blocklistItem}>
                    {label}
                  </Text>
                ))}
                {Platform.OS === 'ios' && (
                  <Text style={styles.previewText} testID="session-details-blocklist-ios-note">
                    {t('sessionDetails.blocklist.iosNote')}
                  </Text>
                )}
              </View>
            )}
          </View>
        )}

        {errorKey !== null && (
          <View>
            <Text style={styles.error} testID="session-details-error">
              {t(`sessionDetails.errors.${errorKey}`)}
            </Text>
            <TouchableOpacity onPress={handleRecoveryAction} testID="session-details-recovery-action">
              <Text style={styles.retryLabel}>{recoveryLabel}</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <TouchableOpacity
        onPress={handleJoin}
        style={[styles.primaryCta, joining && styles.primaryCtaDisabled]}
        disabled={joining}
        testID="session-details-join"
      >
        <Text style={styles.primaryCtaLabel}>
          {joining
            ? t(isRejoin ? 'sessionDetails.rejoining' : 'sessionDetails.joining')
            : t(isRejoin ? 'sessionDetails.rejoin' : 'sessionDetails.join')}
        </Text>
      </TouchableOpacity>
    </View>
  );
};

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  blocklistItem: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: spacing.xs,
  },
  blocklistLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
  completionBonusNote: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.md,
  },
  container: {
    backgroundColor: colors.background,
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
    color: colors.danger,
    marginTop: spacing.md,
  },
  previewText: {
    ...typography.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  primaryCta: {
    alignItems: 'center',
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  primaryCtaDisabled: {
    opacity: 0.5,
  },
  primaryCtaLabel: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
  retryLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
  title: {
    ...typography.heading,
    color: colors.textPrimary,
  },
});

export default SessionDetailsScreen;
