import React from 'react';
import { Linking, StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import { colors, sizing } from '../theme/tokens';
import AuthScreen from './AuthScreen';

// The screen renders inside a SafeAreaView, whose hook throws outright
// ("No safe area value available...") without a provider above it. Reached
// through `.default` because the shipped mock module is a default export —
// the idiomatic one-liner without it fails with "useSafeAreaInsets is not a
// function". It reports all insets 0, so assertions see token padding only.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

// Auth screen (Screen 3), backlog: "Auth error states: wrong OTP, network
// failure, OAuth account-linking dialog" — the error states need a surface,
// so this spec pins Screen 3 itself plus its three error states. Acquisition
// surface (DESIGN_GUIDELINES §0/§9): one screen resolving the "why sign up"
// hesitation, ONE primary action per state (§1), token sizing (§6),
// placeholder en+he copy flagged for the deferred copy pass.
//
// Pinned contracts:
// - Two-step passwordless email flow, a discriminated screen state:
//   'emailEntry' (email input + Continue + the Google/Apple provider buttons)
//   -> requestEmailOtp -> 'codeEntry' (6-digit code input + Verify; the code
//   length matches supabase/config.toml otp_length = 6, itself pinned by
//   auth-providers-config.test.ts) -> verifyEmailOtp.
// - The screen is store- and navigation-agnostic and takes NO completion
//   prop: it only drives auth-service. On a successful verify the real
//   supabase-js client fires SIGNED_IN, attachAuthStateListener — the ONLY
//   client-driven writer of auth state (.claude/skills/supabase-integration/SKILL.md) —
//   flips the auth store, and the App gate unmounts this screen. So on
//   mocked-service success the screen simply shows no error; the exit is
//   pinned at App level (App.auth-gate.spec.tsx) and the real SDK event end
//   to end in integration/email-otp-flow.integration.test.ts.
// - ERROR STATES (the item's core), branched on AuthFailure.kind only —
//   AuthFailure.message is diagnostic text, never rendered
//   (.claude/skills/supabase-integration/SKILL.md):
//   (a) wrong/expired OTP — verify failure kind 'auth_error' (the 403 shape
//       pinned in auth-service.test.ts) shows the invalid-code copy inline
//       and STAYS on code entry so the user can correct and re-verify;
//   (b) network failure — kind 'unexpected' shows a distinct network copy
//       (guarded different from the invalid-code copy), also retryable in
//       place, on both the request and verify steps;
//   (c) OAuth account-linking dialog — provider buttons go through the
//       nativeSignIn seam (native-sign-in.test.ts): 'unavailable' shows the
//       provider-unavailable notice (the Phase 1 placeholder's real state,
//       manual QA pending real SDKs), 'cancelled' is silent, 'success' hands
//       the ID token to auth-service; an exchange failure of kind
//       'provider_email_conflict' (contract pinned in
//       auth-service.account-linking.test.ts) opens the calm account-linking
//       dialog (ARCHITECTURE.md §2) whose use-email affordance returns to
//       email entry; any other exchange 'auth_error' shows a generic provider
//       error, never the dialog.
// - RTL: styles use logical properties and never branch on locale
//   (.claude/skills/i18n/SKILL.md); the he renders prove the copy flows through i18n.
//
// react-native-localize is mocked as established; auth-service and the
// native-sign-in seam are mocked at module level, so an implementation
// reaching past either boundary (own client construction, direct
// supabase.auth calls, a native module) fails these tests. No test touches
// the network — determinism rule, .claude/skills/testing-standards/SKILL.md.

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}

const EN_US: DeviceLocaleStub = {
  countryCode: 'US',
  isRTL: false,
  languageCode: 'en',
  languageTag: 'en-US',
};

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>();

jest.mock('react-native-localize', () => ({
  getLocales: () => mockGetLocales(),
}));

// Local structural stubs for the service results: the spec pins the contract
// the screen consumes, including the 'provider_email_conflict' kind that
// auth-service gains in this same backlog item.
interface AuthFailureStub {
  readonly kind: 'auth_error' | 'provider_email_conflict' | 'unexpected';
  readonly message: string;
  readonly status?: number;
}

type AuthResultStub<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: AuthFailureStub };

interface AuthSessionStub {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: { readonly email: string | null; readonly id: string };
}

type NativeSignInResultStub =
  | { readonly status: 'success'; readonly idToken: string; readonly nonce?: string }
  | { readonly status: 'cancelled' }
  | { readonly status: 'unavailable' };

const USER_ID = '5f0c3a52-7c46-4c1f-9d0e-2a9346f2b70e';

const AUTH_SESSION: AuthSessionStub = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  user: { email: 'dana@example.com', id: USER_ID },
};

const OK_REQUEST: AuthResultStub<null> = { ok: true, value: null };
const OK_VERIFY: AuthResultStub<AuthSessionStub> = { ok: true, value: AUTH_SESSION };

// The wrong/expired-OTP failure shape pinned in auth-service.test.ts.
const INVALID_CODE_FAILURE: AuthResultStub<AuthSessionStub> = {
  ok: false,
  error: { kind: 'auth_error', message: 'Token has expired or is invalid', status: 403 },
};

const NETWORK_FAILURE: AuthResultStub<never> = {
  ok: false,
  error: { kind: 'unexpected', message: 'Network request failed' },
};

// The identity-collision failure shape pinned in
// auth-service.account-linking.test.ts.
const CONFLICT_FAILURE: AuthResultStub<AuthSessionStub> = {
  ok: false,
  error: { kind: 'provider_email_conflict', message: 'Email address already exists', status: 422 },
};

const mockRequestEmailOtp = jest.fn<Promise<AuthResultStub<null>>, [string]>();
const mockVerifyEmailOtp = jest.fn<Promise<AuthResultStub<AuthSessionStub>>, [string, string]>();
const mockExchangeGoogle = jest.fn<Promise<AuthResultStub<AuthSessionStub>>, [unknown]>();
const mockExchangeApple = jest.fn<Promise<AuthResultStub<AuthSessionStub>>, [unknown]>();

jest.mock('../services/auth-service', () => ({
  requestEmailOtp: (email: string) => mockRequestEmailOtp(email),
  signInWithApple: (params: unknown) => mockExchangeApple(params),
  signInWithGoogle: (params: unknown) => mockExchangeGoogle(params),
  verifyEmailOtp: (email: string, code: string) => mockVerifyEmailOtp(email, code),
}));

const mockNativeGoogle = jest.fn<Promise<NativeSignInResultStub>, []>();
const mockNativeApple = jest.fn<Promise<NativeSignInResultStub>, []>();

// The seam module's contract lives in native-sign-in.test.ts; not a virtual
// mock — the module exists, and a virtual mock of an existing module resolves
// unreliably across shared jest workers.
jest.mock('../services/native-sign-in', () => ({
  nativeSignIn: {
    signInWithApple: () => mockNativeApple(),
    signInWithGoogle: () => mockNativeGoogle(),
  },
}));

const renderAuthIn = async (locale: 'en' | 'he'): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);

  // RNTL v14 render is async (returns a Promise) — must be awaited.
  await render(
    <I18nProvider i18n={i18n}>
      <AuthScreen />
    </I18nProvider>,
  );
};

// Drives email entry -> code entry through the real input + CTA, so every
// code-entry case also re-proves the email the screen later verifies with.
const driveToCodeEntry = async (email = 'dana@example.com'): Promise<void> => {
  await fireEvent.changeText(screen.getByTestId('auth-email-input'), email);
  await fireEvent.press(screen.getByTestId('auth-email-continue-cta'));
  await screen.findByTestId('auth-code-input');
};

const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

const asNumber = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new Error(`expected a numeric style value, got: ${String(value)}`);
  }
  return value;
};

beforeEach(() => {
  mockGetLocales.mockReset();
  mockGetLocales.mockReturnValue([EN_US]);
  mockRequestEmailOtp.mockReset();
  mockRequestEmailOtp.mockResolvedValue(OK_REQUEST);
  mockVerifyEmailOtp.mockReset();
  mockVerifyEmailOtp.mockResolvedValue(OK_VERIFY);
  mockExchangeGoogle.mockReset();
  mockExchangeGoogle.mockResolvedValue(OK_VERIFY);
  mockExchangeApple.mockReset();
  mockExchangeApple.mockResolvedValue(OK_VERIFY);
  mockNativeGoogle.mockReset();
  mockNativeGoogle.mockResolvedValue({ status: 'unavailable' });
  mockNativeApple.mockReset();
  mockNativeApple.mockResolvedValue({ status: 'unavailable' });
});

describe('email entry state', () => {
  it('renders the title, email input, Continue CTA, and both provider buttons from the en locale', async () => {
    await renderAuthIn('en');

    expect(screen.getByTestId('auth-screen')).toBeOnTheScreen();
    expect(screen.getByText(en.auth.title)).toBeOnTheScreen();
    expect(screen.getByPlaceholderText(en.auth.emailEntry.placeholder)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.emailEntry.continue)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.providers.google)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.providers.apple)).toBeOnTheScreen();
  });

  it('renders the Hebrew copy under the he locale, proving the screen flows through i18n', async () => {
    // Guard: identical bundles would let a hardcoded literal pass below.
    const enTitle = en.auth.title;
    const heTitle = he.auth.title;
    expect(heTitle).not.toBe(enTitle);

    await renderAuthIn('he');

    expect(screen.getByText(heTitle)).toBeOnTheScreen();
    expect(screen.queryByText(enTitle)).toBeNull();
  });

  it('shows no code entry while on email entry — one primary action per state', async () => {
    await renderAuthIn('en');

    expect(screen.queryByTestId('auth-code-input')).toBeNull();
    expect(screen.queryByTestId('auth-code-verify-cta')).toBeNull();
  });

  it('does not request a code for an empty email', async () => {
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-email-continue-cta'));

    expect(mockRequestEmailOtp).not.toHaveBeenCalled();
    expect(screen.queryByTestId('auth-code-input')).toBeNull();
  });

  // Phase 7 (Release Prep): a passive disclosure (not a blocking checkbox
  // — see legalDisclosure's locale comment for why), shown once on this
  // first-seen step.
  it('renders the ToS/Privacy disclosure and opens each link via Linking', async () => {
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
    await renderAuthIn('en');

    expect(screen.getByTestId('auth-legal-disclosure')).toBeOnTheScreen();
    expect(screen.getByText(en.auth.legalDisclosure.termsOfService)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.legalDisclosure.privacyPolicy)).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('auth-terms-link'));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/legal/terms'));

    await fireEvent.press(screen.getByTestId('auth-privacy-link'));
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/legal/privacy'));

    jest.restoreAllMocks();
  });
});

describe('requesting the code', () => {
  it('requests an OTP for the typed email and advances to code entry on success', async () => {
    await renderAuthIn('en');

    await driveToCodeEntry('dana@example.com');

    expect(mockRequestEmailOtp).toHaveBeenCalledWith('dana@example.com');
    expect(screen.getByTestId('auth-code-input')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-email-input')).toBeNull();
  });

  it('stays on email entry with the request-failed copy on an auth_error, keeping retry available', async () => {
    mockRequestEmailOtp.mockResolvedValue({
      ok: false,
      error: { kind: 'auth_error', message: 'over_email_send_rate_limit', status: 429 },
    });
    await renderAuthIn('en');

    await fireEvent.changeText(screen.getByTestId('auth-email-input'), 'dana@example.com');
    await fireEvent.press(screen.getByTestId('auth-email-continue-cta'));

    expect(await screen.findByText(en.auth.emailEntry.errors.requestFailed)).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-code-input')).toBeNull();
    // Retryable in place: the same primary action stays available.
    expect(screen.getByTestId('auth-email-continue-cta')).toBeOnTheScreen();
  });

  it('shows the distinct network copy when the request fails unexpectedly', async () => {
    // Distinctness guard: a shared string would collapse (a) and (b) into one
    // indistinguishable presentation.
    expect(en.auth.errors.network).not.toBe(en.auth.emailEntry.errors.requestFailed);
    mockRequestEmailOtp.mockResolvedValue(NETWORK_FAILURE);
    await renderAuthIn('en');

    await fireEvent.changeText(screen.getByTestId('auth-email-input'), 'dana@example.com');
    await fireEvent.press(screen.getByTestId('auth-email-continue-cta'));

    expect(await screen.findByText(en.auth.errors.network)).toBeOnTheScreen();
    expect(screen.queryByText(en.auth.emailEntry.errors.requestFailed)).toBeNull();
    expect(screen.queryByTestId('auth-code-input')).toBeNull();
  });
});

describe('code entry state', () => {
  it('renders the code-entry copy and caps the input at the 6-digit OTP length', async () => {
    await renderAuthIn('en');

    await driveToCodeEntry();

    expect(screen.getByText(en.auth.codeEntry.title)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.codeEntry.body)).toBeOnTheScreen();
    // 6 matches supabase/config.toml otp_length = 6, pinned by
    // auth-providers-config.test.ts — the two must move together.
    expect(screen.getByTestId('auth-code-input').props.maxLength).toBe(6);
  });

  it('verifies the typed code against the email from the entry step', async () => {
    await renderAuthIn('en');
    await driveToCodeEntry('dana@example.com');

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    await waitFor(() => {
      expect(mockVerifyEmailOtp).toHaveBeenCalledWith('dana@example.com', '123456');
    });
    // Success renders no error; the exit itself belongs to the App gate via
    // the auth store (see the header comment) — pinned in
    // App.auth-gate.spec.tsx.
    expect(screen.queryByText(en.auth.codeEntry.errors.invalidCode)).toBeNull();
    expect(screen.queryByText(en.auth.errors.network)).toBeNull();
  });
});

describe('error state (a): wrong or expired OTP', () => {
  it('shows the invalid-code copy inline and stays on code entry for a retry', async () => {
    mockVerifyEmailOtp.mockResolvedValue(INVALID_CODE_FAILURE);
    await renderAuthIn('en');
    await driveToCodeEntry();

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '000000');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    expect(await screen.findByText(en.auth.codeEntry.errors.invalidCode)).toBeOnTheScreen();
    // Retry stays on code entry: input and primary action both survive.
    expect(screen.getByTestId('auth-code-input')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-code-verify-cta')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-email-input')).toBeNull();
  });

  it('styles the error in the danger colour, not as ordinary body text', async () => {
    // Every other screen in the app already renders inline errors in
    // `danger`; this one rendered them in `textPrimary`, i.e. identical to
    // the copy around it. On a dark theme that is worse, not just
    // inconsistent — the only remaining signal that something went wrong is
    // the wording itself.
    mockVerifyEmailOtp.mockResolvedValue(INVALID_CODE_FAILURE);
    await renderAuthIn('en');
    await driveToCodeEntry();

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '000000');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    const error = await screen.findByText(en.auth.codeEntry.errors.invalidCode);
    const style = StyleSheet.flatten(error.props.style as StyleProp<TextStyle>);
    expect(style.color).toBe(colors.danger);
  });

  it('clears the invalid-code error once a corrected code verifies', async () => {
    mockVerifyEmailOtp.mockResolvedValueOnce(INVALID_CODE_FAILURE);
    await renderAuthIn('en');
    await driveToCodeEntry();
    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '000000');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));
    await screen.findByText(en.auth.codeEntry.errors.invalidCode);

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    await waitFor(() => {
      expect(mockVerifyEmailOtp).toHaveBeenCalledTimes(2);
    });
    expect(screen.queryByText(en.auth.codeEntry.errors.invalidCode)).toBeNull();
  });

  it('renders the Hebrew invalid-code copy under the he locale', async () => {
    const enError = en.auth.codeEntry.errors.invalidCode;
    const heError = he.auth.codeEntry.errors.invalidCode;
    expect(heError).not.toBe(enError);
    mockVerifyEmailOtp.mockResolvedValue(INVALID_CODE_FAILURE);
    await renderAuthIn('he');
    await driveToCodeEntry();

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '000000');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    expect(await screen.findByText(heError)).toBeOnTheScreen();
    expect(screen.queryByText(enError)).toBeNull();
  });
});

describe('error state (b): network failure on verify', () => {
  it('shows the network copy — distinct from invalid-code — and keeps the retry on code entry', async () => {
    expect(en.auth.errors.network).not.toBe(en.auth.codeEntry.errors.invalidCode);
    mockVerifyEmailOtp.mockResolvedValue(NETWORK_FAILURE);
    await renderAuthIn('en');
    await driveToCodeEntry();

    await fireEvent.changeText(screen.getByTestId('auth-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    expect(await screen.findByText(en.auth.errors.network)).toBeOnTheScreen();
    expect(screen.queryByText(en.auth.codeEntry.errors.invalidCode)).toBeNull();
    expect(screen.getByTestId('auth-code-input')).toBeOnTheScreen();
    expect(screen.getByTestId('auth-code-verify-cta')).toBeOnTheScreen();
  });
});

describe('provider buttons through the nativeSignIn seam', () => {
  it('asks the seam for a Google sign-in when the Google button is pressed', async () => {
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-google-cta'));

    await waitFor(() => {
      expect(mockNativeGoogle).toHaveBeenCalledTimes(1);
    });
  });

  it("shows the unavailable notice on 'unavailable' and never calls the exchange", async () => {
    // The Phase 1 placeholder's real state (native-sign-in.test.ts): no SDK
    // exists, so dev builds land here — manual QA pending real credentials.
    mockNativeGoogle.mockResolvedValue({ status: 'unavailable' });
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-google-cta'));

    expect(await screen.findByText(en.auth.providers.unavailable)).toBeOnTheScreen();
    expect(mockExchangeGoogle).not.toHaveBeenCalled();
    // Still on email entry — the notice is inline, not a dead end.
    expect(screen.getByTestId('auth-email-input')).toBeOnTheScreen();
  });

  it("stays silent on 'cancelled' — dismissing the native sheet is not an error", async () => {
    mockNativeApple.mockResolvedValue({ status: 'cancelled' });
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-apple-cta'));

    await waitFor(() => {
      expect(mockNativeApple).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByText(en.auth.providers.unavailable)).toBeNull();
    expect(mockExchangeApple).not.toHaveBeenCalled();
  });

  it('hands a Google ID token to the auth-service exchange on success', async () => {
    mockNativeGoogle.mockResolvedValue({ status: 'success', idToken: 'google-id-token' });
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-google-cta'));

    await waitFor(() => {
      expect(mockExchangeGoogle).toHaveBeenCalledWith({ idToken: 'google-id-token' });
    });
  });

  it('hands the Apple ID token and nonce to the auth-service exchange on success', async () => {
    mockNativeApple.mockResolvedValue({
      status: 'success',
      idToken: 'apple-identity-token',
      nonce: 'raw-nonce',
    });
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-apple-cta'));

    await waitFor(() => {
      expect(mockExchangeApple).toHaveBeenCalledWith({
        idToken: 'apple-identity-token',
        nonce: 'raw-nonce',
      });
    });
  });

  it('shows the generic provider error — never the linking dialog — on a non-conflict auth_error', async () => {
    mockNativeGoogle.mockResolvedValue({ status: 'success', idToken: 'google-id-token' });
    mockExchangeGoogle.mockResolvedValue({
      ok: false,
      error: { kind: 'auth_error', message: 'Bad ID token', status: 400 },
    });
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-google-cta'));

    expect(await screen.findByText(en.auth.providers.error)).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-account-linking-dialog')).toBeNull();
  });
});

describe('error state (c): the OAuth account-linking dialog', () => {
  const driveGoogleToConflict = async (): Promise<void> => {
    mockNativeGoogle.mockResolvedValue({ status: 'success', idToken: 'google-id-token' });
    mockExchangeGoogle.mockResolvedValue(CONFLICT_FAILURE);
    await fireEvent.press(screen.getByTestId('auth-google-cta'));
    await screen.findByTestId('auth-account-linking-dialog');
  };

  it("opens the dialog with its calm explanation when the exchange fails with 'provider_email_conflict'", async () => {
    await renderAuthIn('en');

    await driveGoogleToConflict();

    // ARCHITECTURE.md §2 account-linking dialog: explanation + switch-to-email
    // affordance, keyed off AuthFailure.kind alone (never the message).
    expect(screen.getByText(en.auth.accountLinking.title)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.accountLinking.body)).toBeOnTheScreen();
    expect(screen.getByText(en.auth.accountLinking.useEmail)).toBeOnTheScreen();
  });

  it('opens the same dialog from the Apple path — the dialog is provider-agnostic', async () => {
    mockNativeApple.mockResolvedValue({ status: 'success', idToken: 'apple-identity-token' });
    mockExchangeApple.mockResolvedValue(CONFLICT_FAILURE);
    await renderAuthIn('en');

    await fireEvent.press(screen.getByTestId('auth-apple-cta'));

    expect(await screen.findByTestId('auth-account-linking-dialog')).toBeOnTheScreen();
  });

  it('renders the Hebrew dialog copy under the he locale', async () => {
    const enTitle = en.auth.accountLinking.title;
    const heTitle = he.auth.accountLinking.title;
    expect(heTitle).not.toBe(enTitle);
    await renderAuthIn('he');

    await driveGoogleToConflict();

    expect(screen.getByText(heTitle)).toBeOnTheScreen();
    expect(screen.queryByText(enTitle)).toBeNull();
  });

  it('gives the dialog a visible edge against the page behind it', async () => {
    // The one assumption the light palette hid: a dialog filled with
    // `background` over a scrim-dimmed `background` page reads fine while
    // both are white, and vanishes entirely once both are black. The dialog
    // must therefore carry its own surface fill AND a border — asserted
    // against the tokens rather than against literal hexes, so it stays true
    // through any future palette change.
    await renderAuthIn('en');
    await driveGoogleToConflict();

    const dialogStyle = flattenedStyle('auth-account-linking-dialog');
    expect(dialogStyle.backgroundColor).not.toBe(colors.background);
    expect(asNumber(dialogStyle.borderWidth)).toBeGreaterThan(0);
    expect(dialogStyle.borderColor).not.toBe(dialogStyle.backgroundColor);
  });

  it('switch-to-email closes the dialog and returns to email entry', async () => {
    await renderAuthIn('en');
    await driveGoogleToConflict();

    await fireEvent.press(screen.getByTestId('auth-account-linking-use-email-cta'));

    expect(screen.queryByTestId('auth-account-linking-dialog')).toBeNull();
    expect(screen.getByTestId('auth-email-input')).toBeOnTheScreen();
  });
});

describe('token sizing (DESIGN_GUIDELINES §6)', () => {
  it('sizes the email input and Continue CTA to the input/button tokens', async () => {
    await renderAuthIn('en');

    expect(flattenedStyle('auth-email-input').height).toBe(sizing.inputHeight);
    expect(flattenedStyle('auth-email-continue-cta').height).toBe(sizing.buttonHeight);
  });

  it('sizes the code input and Verify CTA to the input/button tokens', async () => {
    await renderAuthIn('en');

    await driveToCodeEntry();

    expect(flattenedStyle('auth-code-input').height).toBe(sizing.inputHeight);
    expect(flattenedStyle('auth-code-verify-cta').height).toBe(sizing.buttonHeight);
  });

  it('keeps both provider buttons at or above the minimum touch target', async () => {
    await renderAuthIn('en');

    for (const testID of ['auth-google-cta', 'auth-apple-cta']) {
      const style = flattenedStyle(testID);
      expect(asNumber(style.minHeight ?? style.height)).toBeGreaterThanOrEqual(
        sizing.minTouchTarget,
      );
    }
  });
});
