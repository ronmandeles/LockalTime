import React from 'react';
import { I18nManager } from 'react-native';

import { fireEvent, render, screen } from '@testing-library/react-native';

import App from './App';
import { useAuthStore } from './state/auth-store';

// App auth-gate wiring (Screen 3), backlog: "Auth error states: wrong OTP,
// network failure, OAuth account-linking dialog" — the ready flow becomes
// Onboarding -> Permission -> Auth (if unauthenticated) -> Home
// (ARCHITECTURE.md §2 order), driven by the existing auth-store gate state.
// Split out of App.spec.tsx so that suite (whose default is now a signed-in
// returning user) keeps pinning the authenticated bootstrap unchanged, while
// this one owns the unauthenticated side.
//
// The wiring-gap standard, both sides:
// - unauthenticated store (INITIAL_SESSION without a session) + both
//   first-launch flags persisted -> the REAL AuthScreen renders, never Home;
// - driving the real email flow through the screen to a successful verify —
//   which fires SIGNED_IN exactly as supabase-js does — flips the auth store
//   through attachAuthStateListener (the ONLY writer of auth state,
//   .claude/skills/supabase-integration/SKILL.md) and lands on Home.
// An App that renders AuthScreen but never reaches Home, or one that skips
// the gate entirely, fails one of the two sides while every unit suite stays
// green.
//
// On the SIGNED_IN emission: the mocked auth-service cannot fire the real
// client event a real verifyOtp fires, so the verify mock emits the identical
// event through the captured onAuthStateChange callback — the exact chain
// production rides on. The one remaining un-JS-testable link (supabase-js
// emitting SIGNED_IN from its own verifyOtp) is covered for real by
// integration/email-otp-flow.integration.test.ts against the local stack.
//
// The auth gate sits AFTER the first-launch gates: an unauthenticated first
// launch still starts at onboarding, and an unhandled permission step still
// precedes auth — pinned here because reordering the gates would keep every
// screen-level suite green.
//
// Mock roster follows App.spec.tsx (react-native-localize, AsyncStorage,
// supabase-client, I18nManager spies), plus auth-service and the
// native-sign-in seam that AuthScreen consumes. No test touches the network —
// determinism rule, .claude/skills/testing-standards/SKILL.md.

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

jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => mockGetLocales(),
  }),
  { virtual: true },
);

// react-native-vision-camera's native module doesn't exist in Jest (Phase 3
// task 3.5) — App.tsx transitively renders ScanSessionScreen via
// navigation, so this mock is required wherever the real App tree mounts.
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({ hasPermission: false, requestPermission: jest.fn() }),
}));

interface RawUserStub {
  readonly email?: string;
  readonly id: string;
}

interface RawSessionStub {
  readonly access_token: string;
  readonly expires_in: number;
  readonly refresh_token: string;
  readonly token_type: 'bearer';
  readonly user: RawUserStub;
}

type AuthChangeCallbackStub = (event: string, session: RawSessionStub | null) => void;

interface OnAuthStateChangeReturnStub {
  readonly data: { readonly subscription: { readonly unsubscribe: () => void } };
}

const USER_ID = '5f0c3a52-7c46-4c1f-9d0e-2a9346f2b70e';

const RAW_SESSION: RawSessionStub = {
  access_token: 'access-token-1',
  expires_in: 3600,
  refresh_token: 'refresh-token-1',
  token_type: 'bearer',
  user: { email: 'dana@example.com', id: USER_ID },
};

const MAPPED_SESSION = {
  accessToken: 'access-token-1',
  refreshToken: 'refresh-token-1',
  user: { email: 'dana@example.com', id: USER_ID },
};

const mockUnsubscribe = jest.fn<void, []>();
let capturedAuthCallback: AuthChangeCallbackStub | undefined;
// Per-test knob for what supabase-js delivers with the INITIAL_SESSION it
// always fires on attach: null = cold start with nothing persisted
// (unauthenticated — this suite's default), a session = cold-start hydration.
let sessionDeliveredOnAttach: RawSessionStub | null = null;

const mockOnAuthStateChange = jest.fn<OnAuthStateChangeReturnStub, [AuthChangeCallbackStub]>(
  (callback) => {
    capturedAuthCallback = callback;
    callback('INITIAL_SESSION', sessionDeliveredOnAttach);
    return { data: { subscription: { unsubscribe: () => mockUnsubscribe() } } };
  },
);

jest.mock('./services/supabase-client', () => ({
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (callback: AuthChangeCallbackStub) => mockOnAuthStateChange(callback),
    },
  }),
}));

const emitAuthEvent = (event: string, session: RawSessionStub | null): void => {
  if (capturedAuthCallback === undefined) {
    throw new Error('attachAuthStateListener has not registered a callback');
  }
  capturedAuthCallback(event, session);
};

interface AuthResultOkStub<T> {
  readonly ok: true;
  readonly value: T;
}

const mockRequestEmailOtp = jest.fn<Promise<AuthResultOkStub<null>>, [string]>();
const mockVerifyEmailOtp = jest.fn<
  Promise<AuthResultOkStub<typeof MAPPED_SESSION>>,
  [string, string]
>();
const mockExchangeGoogle = jest.fn<Promise<never>, [unknown]>();
const mockExchangeApple = jest.fn<Promise<never>, [unknown]>();

// auth-store imports toAuthSession from this module, so the factory carries a
// faithful mapper alongside the flow mocks; the real mapping is pinned by
// auth-service.test.ts and auth-store.test.ts, so drift fails one of those.
jest.mock('./services/auth-service', () => ({
  requestEmailOtp: (email: string) => mockRequestEmailOtp(email),
  signInWithApple: (params: unknown) => mockExchangeApple(params),
  signInWithGoogle: (params: unknown) => mockExchangeGoogle(params),
  signOut: () => Promise.resolve({ ok: true, value: null }),
  toAuthSession: (session: RawSessionStub) => ({
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    user: { email: session.user.email ?? null, id: session.user.id },
  }),
  verifyEmailOtp: (email: string, code: string) => mockVerifyEmailOtp(email, code),
}));

const mockNativeGoogle = jest.fn<Promise<{ status: 'unavailable' }>, []>();
const mockNativeApple = jest.fn<Promise<{ status: 'unavailable' }>, []>();

// The seam module's contract lives in native-sign-in.test.ts; not a virtual
// mock — the module exists, and a virtual mock of an existing module resolves
// unreliably across shared jest workers.
jest.mock('./services/native-sign-in', () => ({
  nativeSignIn: {
    signInWithApple: () => mockNativeApple(),
    signInWithGoogle: () => mockNativeGoogle(),
  },
}));

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

jest.mock(
  '@react-native-async-storage/async-storage',
  () => ({
    __esModule: true,
    default: {
      getItem: (key: string) => mockGetItem(key),
      removeItem: (key: string) => mockRemoveItem(key),
      setItem: (key: string, value: string) => mockSetItem(key, value),
    },
  }),
  { virtual: true },
);

// Same literal-key convention as App.spec.tsx: the store suites pin the same
// literals, so drift on either side fails one of the two.
const ONBOARDING_SEEN_KEY = '@lockal-time/onboarding-seen';
const PERMISSION_STEP_HANDLED_KEY = '@lockal-time/permission-step-handled';

interface PersistedFlagsStub {
  readonly onboardingSeen: boolean;
  readonly permissionHandled: boolean;
}

const stubPersistedFlags = ({ onboardingSeen, permissionHandled }: PersistedFlagsStub): void => {
  mockGetItem.mockImplementation((key) => {
    if (key === ONBOARDING_SEEN_KEY) {
      return Promise.resolve(onboardingSeen ? 'true' : null);
    }
    if (key === PERMISSION_STEP_HANDLED_KEY) {
      return Promise.resolve(permissionHandled ? 'true' : null);
    }
    return Promise.resolve(null);
  });
};

describe('App auth gate', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
    capturedAuthCallback = undefined;
    sessionDeliveredOnAttach = null;
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockClear();
    mockRequestEmailOtp.mockReset();
    mockRequestEmailOtp.mockResolvedValue({ ok: true, value: null });
    mockVerifyEmailOtp.mockReset();
    mockVerifyEmailOtp.mockResolvedValue({ ok: true, value: MAPPED_SESSION });
    mockNativeGoogle.mockReset();
    mockNativeGoogle.mockResolvedValue({ status: 'unavailable' });
    mockNativeApple.mockReset();
    mockNativeApple.mockResolvedValue({ status: 'unavailable' });
    mockExchangeGoogle.mockReset();
    mockExchangeApple.mockReset();
    mockGetItem.mockReset();
    // Default: both first-launch gates already passed, so only the auth gate
    // decides between AuthScreen and Home.
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: true });
    mockRemoveItem.mockReset();
    mockRemoveItem.mockResolvedValue(undefined);
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    // The store is a module singleton; reset so no test inherits a session.
    useAuthStore.setState({ auth: { status: 'unauthenticated' } });
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shows the auth screen, never Home, when the gates are passed but no session exists', async () => {
    // RNTL v14 render is async (returns a Promise) — must be awaited.
    await render(<App />);

    // findBy* awaits i18n init + gate hydrations before the first paint.
    expect(await screen.findByTestId('auth-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('lands directly on Home when INITIAL_SESSION hydrates a persisted session', async () => {
    // Cold-start hydration: supabase-js restores the AsyncStorage session and
    // delivers it with INITIAL_SESSION — a returning signed-in user never
    // sees the auth screen.
    sessionDeliveredOnAttach = RAW_SESSION;

    await render(<App />);

    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-screen')).toBeNull();
  });

  it('keeps onboarding first: an unauthenticated first launch starts at onboarding, not auth', async () => {
    stubPersistedFlags({ onboardingSeen: false, permissionHandled: false });

    await render(<App />);

    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-screen')).toBeNull();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('keeps the permission step ahead of auth when it is still unhandled', async () => {
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: false });

    await render(<App />);

    expect(await screen.findByTestId('permission-priming-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-screen')).toBeNull();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('drives the email flow to a verified session and lands on Home', async () => {
    mockVerifyEmailOtp.mockImplementation(() => {
      // What the real client does inside verifyOtp: fire SIGNED_IN with the
      // new session. Emitting it here keeps cause and effect together — the
      // sign-in event exists because verify succeeded, not because the test
      // chose an ordering. (No assertions inside the mock: the service
      // contract never throws, so the mock must not either.)
      emitAuthEvent('SIGNED_IN', RAW_SESSION);
      return Promise.resolve({ ok: true, value: MAPPED_SESSION });
    });
    await render(<App />);
    expect(await screen.findByTestId('auth-screen')).toBeOnTheScreen();

    // RNTL v14 fireEvent is awaited like render, wrapping the state update.
    await fireEvent.changeText(screen.getByTestId('auth-email-input'), 'dana@example.com');
    await fireEvent.press(screen.getByTestId('auth-email-continue-cta'));
    await fireEvent.changeText(await screen.findByTestId('auth-code-input'), '123456');
    await fireEvent.press(screen.getByTestId('auth-code-verify-cta'));

    expect(mockVerifyEmailOtp).toHaveBeenCalledWith('dana@example.com', '123456');
    // Both sides close: the store flipped through the listener, and the gate
    // swapped the auth screen for Home.
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('auth-screen')).toBeNull();
    expect(useAuthStore.getState().auth).toEqual({
      status: 'authenticated',
      session: MAPPED_SESSION,
    });
  });
});
