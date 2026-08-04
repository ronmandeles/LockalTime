import React, { useState } from 'react';
import { Linking, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';

import GradientButton from '../components/GradientButton';
import { API_BASE_URL } from '../config/api-config';
import {
  requestEmailOtp,
  signInWithApple,
  signInWithGoogle,
  verifyEmailOtp,
  type AuthFailure,
  type AuthResult,
  type AuthSession,
} from '../services/auth-service';
import { nativeSignIn, type NativeSignInResult } from '../services/native-sign-in';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// Auth screen (Screen 3), backlog: "Auth error states: wrong OTP, network
// failure, OAuth account-linking dialog". Two-step passwordless email flow
// (email entry -> 6-digit code entry) plus Google/Apple through the
// nativeSignIn seam. Contracts pinned in AuthScreen.spec.tsx:
// - Error presentation branches on AuthFailure.kind ONLY — the failure's
//   diagnostic message is never rendered
//   (.claude/skills/supabase-integration/SKILL.md); every error keeps its
//   state retryable in place.
// - 'provider_email_conflict' on an ID-token exchange opens the calm
//   account-linking dialog (ARCHITECTURE.md §2); its use-email affordance
//   returns to email entry. Any other exchange auth_error shows the generic
//   provider error, never the dialog.
// - The screen is store- and navigation-agnostic and takes no completion
//   prop: a successful verify makes supabase-js fire SIGNED_IN, the auth
//   store flips through attachAuthStateListener, and the App gate unmounts
//   this screen (pinned in App.auth-gate.spec.tsx; the supabase-js emission
//   itself in integration/email-otp-flow.integration.test.ts).
// Copy is placeholder (flagged in the locale bundles); styling is
// token-based, neutral grayscale only, direction-neutral per
// .claude/skills/i18n/SKILL.md.

// 6 matches supabase/config.toml otp_length = 6, pinned by
// auth-providers-config.test.ts — the two must move together.
const OTP_LENGTH = 6;

type EntryStep = 'emailEntry' | 'codeEntry';

// One inline error slot, discriminated so exactly one presentation renders;
// each maps to a locale key, never to a failure's message text.
type InlineError =
  | 'none'
  | 'requestFailed'
  | 'network'
  | 'invalidCode'
  | 'providerUnavailable'
  | 'providerError';

const errorForRequestFailure = (failure: AuthFailure): InlineError =>
  failure.kind === 'unexpected' ? 'network' : 'requestFailed';

const errorForVerifyFailure = (failure: AuthFailure): InlineError =>
  failure.kind === 'unexpected' ? 'network' : 'invalidCode';

const AuthScreen = (): React.JSX.Element => {
  const { t } = useTranslation();
  const [step, setStep] = useState<EntryStep>('emailEntry');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [inlineError, setInlineError] = useState<InlineError>('none');
  const [isLinkingDialogOpen, setIsLinkingDialogOpen] = useState(false);

  const handleContinuePress = (): void => {
    if (email.trim() === '') {
      // No address, no request — the empty state is not an error, the field
      // is simply still waiting for input.
      return;
    }
    // Service results never reject (auth-service contract), so the .then
    // chain is complete; same not-awaited shape as the other screens.
    requestEmailOtp(email).then((result) => {
      if (result.ok) {
        setInlineError('none');
        setStep('codeEntry');
        return;
      }
      setInlineError(errorForRequestFailure(result.error));
    });
  };

  const handleVerifyPress = (): void => {
    verifyEmailOtp(email, code).then((result) => {
      if (result.ok) {
        // Success renders nothing here: SIGNED_IN flips the auth store and
        // the App gate unmounts this screen (see header).
        setInlineError('none');
        return;
      }
      setInlineError(errorForVerifyFailure(result.error));
    });
  };

  const handleExchangeResult = (result: AuthResult<AuthSession>): void => {
    if (result.ok) {
      setInlineError('none');
      return;
    }
    if (result.error.kind === 'provider_email_conflict') {
      setIsLinkingDialogOpen(true);
      return;
    }
    setInlineError(result.error.kind === 'unexpected' ? 'network' : 'providerError');
  };

  const handleNativeResult = (
    native: NativeSignInResult,
    exchange: (params: { idToken: string; nonce?: string }) => Promise<AuthResult<AuthSession>>,
  ): void => {
    if (native.status === 'unavailable') {
      setInlineError('providerUnavailable');
      return;
    }
    if (native.status === 'cancelled') {
      // Dismissing the native sheet is a decision, not an error — stay silent.
      return;
    }
    // exactOptionalPropertyTypes: the nonce is included only when present.
    const params =
      native.nonce === undefined
        ? { idToken: native.idToken }
        : { idToken: native.idToken, nonce: native.nonce };
    exchange(params).then(handleExchangeResult);
  };

  const handleGooglePress = (): void => {
    nativeSignIn.signInWithGoogle().then((native) => {
      handleNativeResult(native, signInWithGoogle);
    });
  };

  const handleApplePress = (): void => {
    nativeSignIn.signInWithApple().then((native) => {
      handleNativeResult(native, signInWithApple);
    });
  };

  const handleUseEmailPress = (): void => {
    // The dialog resolves into the email flow: close, clear provider errors,
    // and land back on email entry.
    setIsLinkingDialogOpen(false);
    setInlineError('none');
    setStep('emailEntry');
  };

  const inlineErrorText = (): string | null => {
    switch (inlineError) {
      case 'requestFailed':
        return t('auth.emailEntry.errors.requestFailed');
      case 'network':
        return t('auth.errors.network');
      case 'invalidCode':
        return t('auth.codeEntry.errors.invalidCode');
      case 'providerUnavailable':
        return t('auth.providers.unavailable');
      case 'providerError':
        return t('auth.providers.error');
      case 'none':
        return null;
    }
  };

  const errorText = inlineErrorText();

  return (
    <SafeAreaView style={styles.container} testID="auth-screen">
      <View style={styles.content}>
        <Text style={styles.title}>{t('auth.title')}</Text>
        {step === 'emailEntry' ? (
          <>
            <TextInput
              autoCapitalize="none"
              autoComplete="email"
              inputMode="email"
              onChangeText={setEmail}
              placeholder={t('auth.emailEntry.placeholder')}
              style={styles.input}
              testID="auth-email-input"
              value={email}
            />
            {errorText !== null ? <Text style={styles.errorText}>{errorText}</Text> : null}
            <GradientButton
              label={t('auth.emailEntry.continue')}
              onPress={handleContinuePress}
              style={styles.primaryCta}
              testID="auth-email-continue-cta"
            />
            <TouchableOpacity
              onPress={handleGooglePress}
              style={styles.providerCta}
              testID="auth-google-cta"
            >
              <Text style={styles.providerCtaLabel}>{t('auth.providers.google')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={handleApplePress}
              style={styles.providerCta}
              testID="auth-apple-cta"
            >
              <Text style={styles.providerCtaLabel}>{t('auth.providers.apple')}</Text>
            </TouchableOpacity>

            <Text style={styles.legalDisclosure} testID="auth-legal-disclosure">
              {t('auth.legalDisclosure.prefix')}{' '}
              <Text
                style={styles.legalLink}
                onPress={() => {
                  Linking.openURL(`${API_BASE_URL}/legal/terms`).catch(() => undefined);
                }}
                testID="auth-terms-link"
              >
                {t('auth.legalDisclosure.termsOfService')}
              </Text>{' '}
              {t('auth.legalDisclosure.and')}{' '}
              <Text
                style={styles.legalLink}
                onPress={() => {
                  Linking.openURL(`${API_BASE_URL}/legal/privacy`).catch(() => undefined);
                }}
                testID="auth-privacy-link"
              >
                {t('auth.legalDisclosure.privacyPolicy')}
              </Text>
              .
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.stepTitle}>{t('auth.codeEntry.title')}</Text>
            <Text style={styles.body}>{t('auth.codeEntry.body')}</Text>
            <TextInput
              autoComplete="one-time-code"
              inputMode="numeric"
              maxLength={OTP_LENGTH}
              onChangeText={setCode}
              style={styles.input}
              testID="auth-code-input"
              value={code}
            />
            {errorText !== null ? <Text style={styles.errorText}>{errorText}</Text> : null}
            <GradientButton
              label={t('auth.codeEntry.verify')}
              onPress={handleVerifyPress}
              style={styles.primaryCta}
              testID="auth-code-verify-cta"
            />
          </>
        )}
      </View>
      {isLinkingDialogOpen ? (
        <View style={styles.dialogOverlay}>
          <View style={styles.dialog} testID="auth-account-linking-dialog">
            <Text style={styles.stepTitle}>{t('auth.accountLinking.title')}</Text>
            <Text style={styles.body}>{t('auth.accountLinking.body')}</Text>
            <GradientButton
              label={t('auth.accountLinking.useEmail')}
              onPress={handleUseEmailPress}
              style={styles.primaryCta}
              testID="auth-account-linking-use-email-cta"
            />
          </View>
        </View>
      ) : null}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: colors.textMuted,
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
  content: {
    flex: 1,
    justifyContent: 'center',
  },
  dialog: {
    // Surface + border, not `background`: on a dark palette a dialog filled
    // with the page color over a scrim-dimmed page of the same color has no
    // visible edge at all (pinned in AuthScreen.spec.tsx).
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.xl,
    borderWidth: 1,
    padding: spacing.lg,
  },
  dialogOverlay: {
    backgroundColor: colors.overlay,
    bottom: 0,
    end: 0,
    justifyContent: 'center',
    padding: spacing.lg,
    position: 'absolute',
    start: 0,
    top: 0,
  },
  errorText: {
    ...typography.caption,
    color: colors.textPrimary,
    marginTop: spacing.sm,
  },
  legalDisclosure: {
    ...typography.caption,
    color: colors.textFaint,
    marginTop: spacing.lg,
    textAlign: 'center',
  },
  legalLink: {
    ...typography.caption,
    // The accent reads as "this is tappable" where an underline alone on
    // faint text does not.
    color: colors.primary,
    textDecorationLine: 'underline',
  },
  input: {
    ...typography.body,
    // Filled rather than outline-only: on black, a 1px border around
    // nothing barely registers as a field. The fill is what makes the input
    // look like somewhere to type.
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    color: colors.textPrimary,
    height: sizing.inputHeight,
    marginTop: spacing.md,
    paddingEnd: spacing.md,
    paddingStart: spacing.md,
  },
  // The gradient CTA owns its own height/radius/fill (GradientButton); this
  // only places it.
  primaryCta: {
    marginTop: spacing.md,
  },
  providerCta: {
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
  providerCtaLabel: {
    ...typography.body,
    color: colors.textPrimary,
  },
  stepTitle: {
    ...typography.heading,
    color: colors.textPrimary,
    marginTop: spacing.md,
  },
  title: {
    ...typography.display,
    color: colors.textPrimary,
  },
});

export default AuthScreen;
