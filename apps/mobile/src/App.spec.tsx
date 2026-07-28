import React from 'react';
import { I18nManager } from 'react-native';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import App from './App';
import { en } from './i18n/locales/en';
import { useActiveSessionStore } from './state/active-session-store';

// App bootstrap contract. The Phase 0 smoke test (testID) proves React
// Navigation boots; the Phase 1 additions prove App actually wires the i18n
// foundation — mounts the provider with an initialized instance (raw keys or
// a hardcoded literal would fail the visible-text assertion) and invokes the
// layout-direction sync. Without these, an App that never mounts I18nProvider
// would silently pass on react-i18next's uninitialized default instance.
// react-native-localize is mocked virtually (not installed until Stage B);
// no test reads the machine's real locale. Color palette is deferred, so no
// style/color assertions.
//
// Phase 1 auth wiring addition: App's bootstrap must attach the Supabase auth
// listener (attachAuthStateListener) and detach it on unmount — otherwise the
// auth-store wiring is dead code and cold-start session hydration never runs,
// with every unit suite still green. The shared client module is mocked
// virtually (same pattern as auth-store.test.ts); no test touches the network.
//
// Phase 1 onboarding gating (Screen 1): App owns the first-launch gate —
// unseen -> OnboardingScreen, seen -> Home; completing/skipping onboarding
// marks the flag seen (the store contract lives in onboarding-store.test.ts;
// here only the rendering outcome is pinned, via testIDs, leaving App free to
// gate with conditional rendering or navigator state). AsyncStorage is mocked
// virtually; the default is a returning user (flag persisted), so every
// pre-gating assertion about Home keeps holding unchanged.
//
// The completion-wiring cases are the load-bearing assertions: an App that
// passes a gate screen a no-op callback keeps every unit suite green while
// users can never leave that gate — only driving the real press through
// proves completion both exits AND persists.
//
// Phase 1 permission gating (Screen 2): the gate order is Onboarding ->
// Permission priming -> the rest (ARCHITECTURE.md §2). App shows
// PermissionPrimingScreen once onboarding is seen but the persisted
// permission-step flag is unhandled; handling it (granted request OR the
// denied fallback's proceed-anyway — the flag records that the step was
// handled, never that blocking works) lands on Home and persists the flag.
// The blocking-permissions service module is mocked virtually (Stage B), so
// pressing the screen's real CTAs here proves the full chain App -> screen ->
// service -> onHandled -> permission store, both sides.
//
// Phase 1 auth gating (Screen 3): this suite's default user is now SIGNED IN
// — the onAuthStateChange mock delivers INITIAL_SESSION with a persisted
// session on attach, exactly as supabase-js does on a cold start with a
// stored session. That keeps every Home assertion below pinning the
// authenticated bootstrap unchanged once the auth gate lands; the
// unauthenticated side (AuthScreen shown, verify success reaching Home) is
// owned by App.auth-gate.spec.tsx.

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

type AuthChangeCallbackStub = (event: string, session: unknown) => void;

interface OnAuthStateChangeReturnStub {
  readonly data: { readonly subscription: { readonly unsubscribe: () => void } };
}

// The raw supabase-js session shape delivered to auth listeners; mapped by
// the real toAuthSession (pinned in auth-service.test.ts / auth-store.test.ts).
const RAW_SESSION = {
  access_token: 'access-token-1',
  expires_in: 3600,
  refresh_token: 'refresh-token-1',
  token_type: 'bearer',
  user: { email: 'dana@example.com', id: '5f0c3a52-7c46-4c1f-9d0e-2a9346f2b70e' },
};

const mockUnsubscribe = jest.fn<void, []>();

const mockOnAuthStateChange = jest.fn<OnAuthStateChangeReturnStub, [AuthChangeCallbackStub]>(
  (callback) => {
    // supabase-js always fires INITIAL_SESSION on attach; delivering a
    // persisted session makes this suite's default a signed-in returning user
    // (cold-start hydration from AsyncStorage), so the auth gate keeps every
    // Home assertion below unchanged. The unauthenticated side lives in
    // App.auth-gate.spec.tsx.
    callback('INITIAL_SESSION', RAW_SESSION);
    return { data: { subscription: { unsubscribe: () => mockUnsubscribe() } } };
  },
);

// Mocking the shared client module (not @supabase/supabase-js) intercepts the
// whole transitive import chain App pulls in via the auth wiring, so the
// SDK/AsyncStorage packages' untranspiled ESM is never loaded by this suite.
// Not virtual: the module exists, and a virtual mock of an existing module
// resolves unreliably across shared jest workers.
jest.mock('./services/supabase-client', () => ({
  getSupabaseClient: () => ({
    auth: {
      onAuthStateChange: (callback: AuthChangeCallbackStub) => mockOnAuthStateChange(callback),
    },
  }),
}));

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

// Both gates read their persisted flags straight through AsyncStorage (via
// their stores), so App suites control first-launch vs returning user by
// stubbing the storage read — virtual, same pattern as elsewhere.
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

// Keys asserted/stubbed as literals: importing the stores' constants here
// would fail this whole suite's load in Stage A; the same literals are pinned
// in onboarding-store.test.ts / permission-store.test.ts, so drift on either
// side fails one of the two suites.
const ONBOARDING_SEEN_KEY = '@lockal-time/onboarding-seen';
const PERMISSION_STEP_HANDLED_KEY = '@lockal-time/permission-step-handled';
// Pinned the same way as the other two — the real literal lives in
// active-session-store.test.ts.
const ACTIVE_SESSION_ID_KEY = '@lockal-time/last-active-session-id';

interface PersistedFlagsStub {
  readonly onboardingSeen: boolean;
  readonly permissionHandled: boolean;
  // undefined (the default across this suite) means no interrupted session
  // — Screen 13 (Welcome Back) never shows, which is what every pre-Phase-4
  // assertion in this file already assumes.
  readonly lastActiveSessionId?: string;
}

// The gates persist under separate keys, so the read stub must answer
// per-key — a blanket resolved value could not express "onboarding seen,
// permission step still unhandled", the state Screen 2 gating hinges on.
const stubPersistedFlags = ({
  onboardingSeen,
  permissionHandled,
  lastActiveSessionId,
}: PersistedFlagsStub): void => {
  mockGetItem.mockImplementation((key) => {
    if (key === ONBOARDING_SEEN_KEY) {
      return Promise.resolve(onboardingSeen ? 'true' : null);
    }
    if (key === PERMISSION_STEP_HANDLED_KEY) {
      return Promise.resolve(permissionHandled ? 'true' : null);
    }
    if (key === ACTIVE_SESSION_ID_KEY) {
      return Promise.resolve(lastActiveSessionId ?? null);
    }
    return Promise.resolve(null);
  });
};

// Screen 13 (Welcome Back) reads sessions.repository's fetchSession
// directly; SessionCompletionScreen (reachable when Welcome Back resolves
// "the session already ended") reads fetchSessionParticipant/
// fetchRewardsHistory. Mocked here the same way api-client is mocked in the
// screen-level specs — this suite only needs App's gate wiring proven, not
// these functions' own contracts (session-repository.test.ts owns those).
const mockFetchSession = jest.fn();
const mockFetchSessionParticipant = jest.fn();
const mockFetchRewardsHistory = jest.fn();
jest.mock('./services/session-repository', () => ({
  fetchSession: (...args: unknown[]) => mockFetchSession(...args),
  fetchSessionParticipant: (...args: unknown[]) => mockFetchSessionParticipant(...args),
  fetchRewardsHistory: (...args: unknown[]) => mockFetchRewardsHistory(...args),
}));

interface PermissionStatusStub {
  readonly status: 'granted' | 'denied' | 'undetermined';
}

const mockPermissionGetStatus = jest.fn<Promise<PermissionStatusStub>, []>();
const mockPermissionRequest = jest.fn<Promise<PermissionStatusStub>, []>();

// The permission screen renders for real in this suite; mocking the service
// module (virtually — Stage B) keeps the placeholder/native layer out while
// letting each test choose the request outcome its path needs.
jest.mock(
  './services/blocking-permissions',
  () => ({
    blockingPermissions: {
      getStatus: () => mockPermissionGetStatus(),
      request: () => mockPermissionRequest(),
    },
    requestBatteryOptimizationExemption: () => Promise.resolve(),
  }),
  { virtual: true },
);

describe('App', () => {
  let forceRTLSpy: jest.SpyInstance<void, [forceRTL: boolean]>;

  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
    mockOnAuthStateChange.mockClear();
    mockUnsubscribe.mockClear();
    // Default: returning user — both gate flags are persisted, so all
    // pre-gating Home assertions in this suite hold unchanged.
    mockGetItem.mockReset();
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: true });
    mockPermissionGetStatus.mockReset();
    mockPermissionGetStatus.mockResolvedValue({ status: 'undetermined' });
    mockPermissionRequest.mockReset();
    mockPermissionRequest.mockResolvedValue({ status: 'undetermined' });
    mockRemoveItem.mockReset();
    mockRemoveItem.mockResolvedValue(undefined);
    mockSetItem.mockReset();
    mockSetItem.mockResolvedValue(undefined);
    mockFetchSession.mockReset();
    mockFetchSessionParticipant.mockReset().mockResolvedValue({ ok: true, value: null });
    mockFetchRewardsHistory.mockReset().mockResolvedValue({ ok: true, value: [] });
    // The real store is a module singleton — without resetting it, one
    // test's resolved Welcome Back outcome (a real button press updating
    // real state) would leak into the next test's fresh App render.
    useActiveSessionStore.setState({
      activeSession: { status: 'hydrating' },
      pendingWelcomeBackNavigation: null,
    });
    // I18nManager is mocked in every test here (not just the RTL one) so the
    // bootstrap can never mutate real native layout state mid-suite.
    jest.spyOn(I18nManager, 'allowRTL').mockImplementation(() => undefined);
    forceRTLSpy = jest.spyOn(I18nManager, 'forceRTL').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('renders the Home placeholder screen as the initial route', async () => {
    // RNTL v14 render is async (returns a Promise) — must be awaited.
    await render(<App />);

    // findBy* awaits React Navigation's async mount of the initial screen.
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
  });

  it('shows the en home title for an en-US device, proving App mounts the i18n provider', async () => {
    await render(<App />);

    // findBy* also awaits App's async i18n init before the first paint of
    // translated text. Asserts against the locale module, never a literal.
    expect(await screen.findByText(en.home.title)).toBeOnTheScreen();
  });

  it('syncs the layout direction to LTR for an en device locale during bootstrap', async () => {
    await render(<App />);

    // waitFor covers an async bootstrap: the call must land once init settles.
    await waitFor(() => {
      expect(forceRTLSpy).toHaveBeenCalledWith(false);
    });
    expect(forceRTLSpy).not.toHaveBeenCalledWith(true);
  });

  it('registers the Supabase auth listener during bootstrap', async () => {
    await render(<App />);

    // waitFor covers an async bootstrap: attaching may happen after i18n init.
    await waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    });
  });

  it('renders the onboarding carousel on first launch, when no flags are persisted', async () => {
    stubPersistedFlags({ onboardingSeen: false, permissionHandled: false });

    await render(<App />);

    // findBy* awaits both i18n init and the async AsyncStorage hydration.
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('skipping onboarding on first launch advances to permission priming and persists the flag', async () => {
    stubPersistedFlags({ onboardingSeen: false, permissionHandled: false });
    await render(<App />);
    expect(await screen.findByTestId('onboarding-screen')).toBeOnTheScreen();

    // RNTL v14 fireEvent is awaited like render, wrapping the state update.
    await fireEvent.press(screen.getByTestId('onboarding-skip'));

    // (a) completion actually exits the gate — onto Screen 2, never straight
    // to Home (ARCHITECTURE.md §2 order: Onboarding -> Permission -> rest)...
    expect(await screen.findByTestId('permission-priming-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(screen.queryByTestId('home-screen')).toBeNull();

    // (b) ...and persists. waitFor covers the async storage write.
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(ONBOARDING_SEEN_KEY, 'true');
    });
  });

  it('renders Home, skipping both gates, once both flags are persisted', async () => {
    await render(<App />);

    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(screen.queryByTestId('permission-priming-screen')).toBeNull();
  });

  it('shows permission priming, not Home, when onboarding is seen but the step is unhandled', async () => {
    // The returning-user recovery case: onboarding never re-shows, but an
    // unresolved permission step still gates before Home.
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: false });

    await render(<App />);

    expect(await screen.findByTestId('permission-priming-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('onboarding-screen')).toBeNull();
    expect(screen.queryByTestId('home-screen')).toBeNull();
  });

  it('granted permission request lands on Home and persists the handled flag', async () => {
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: false });
    mockPermissionRequest.mockResolvedValue({ status: 'granted' });
    await render(<App />);
    expect(await screen.findByTestId('permission-priming-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('permission-allow-cta'));

    // (a) handling actually exits the gate...
    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('permission-priming-screen')).toBeNull();

    // (b) ...and persists, so returning users skip the priming.
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(PERMISSION_STEP_HANDLED_KEY, 'true');
    });
  });

  it('proceeding anyway from the denied fallback lands on Home and persists the handled flag', async () => {
    // The recovery path the backlog item exists for: denial must never
    // hard-wall the app (see PermissionPrimingScreen.spec.tsx for the full
    // reasoning), and proceeding still counts as handling the step.
    stubPersistedFlags({ onboardingSeen: true, permissionHandled: false });
    mockPermissionRequest.mockResolvedValue({ status: 'denied' });
    await render(<App />);
    expect(await screen.findByTestId('permission-priming-screen')).toBeOnTheScreen();

    await fireEvent.press(screen.getByTestId('permission-allow-cta'));
    await fireEvent.press(await screen.findByTestId('permission-proceed-anyway'));

    expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
    expect(screen.queryByTestId('permission-priming-screen')).toBeNull();
    await waitFor(() => {
      expect(mockSetItem).toHaveBeenCalledWith(PERMISSION_STEP_HANDLED_KEY, 'true');
    });
  });

  it('detaches the auth listener on unmount, so remounts never leak listeners', async () => {
    const view = await render(<App />);
    await waitFor(() => {
      expect(mockOnAuthStateChange).toHaveBeenCalledTimes(1);
    });

    // RNTL v14 unmount is async like render — must be awaited before the
    // effect cleanup is observable.
    await view.unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  describe('Welcome Back gate (Phase 4 task 12, Screen 13)', () => {
    it('shows Welcome Back, not Home, when a last-active session was persisted', async () => {
      stubPersistedFlags({ onboardingSeen: true, permissionHandled: true, lastActiveSessionId: 'session-99' });
      mockFetchSession.mockResolvedValue({
        ok: true,
        value: { status: 'active', started_at: '2026-07-28T12:00:00.000Z' },
      });

      await render(<App />);

      expect(await screen.findByTestId('welcome-back-screen')).toBeOnTheScreen();
      expect(screen.queryByTestId('home-screen')).toBeNull();
    });

    it('rejoining from Welcome Back lands on Session Details in rejoin mode (no QR re-scan)', async () => {
      stubPersistedFlags({ onboardingSeen: true, permissionHandled: true, lastActiveSessionId: 'session-99' });
      mockFetchSession.mockResolvedValue({
        ok: true,
        value: { status: 'active', started_at: '2026-07-28T12:00:00.000Z' },
      });
      await render(<App />);
      await fireEvent.press(await screen.findByTestId('welcome-back-rejoin'));

      expect(await screen.findByTestId('session-details-screen')).toBeOnTheScreen();
      expect(screen.getByText(en.sessionDetails.rejoinTitle)).toBeOnTheScreen();
    });

    it('routes straight to Session Completion when the session already ended while away', async () => {
      stubPersistedFlags({ onboardingSeen: true, permissionHandled: true, lastActiveSessionId: 'session-99' });
      mockFetchSession.mockResolvedValue({
        ok: true,
        value: { status: 'completed', started_at: '2026-07-28T12:00:00.000Z' },
      });

      await render(<App />);

      expect(await screen.findByTestId('session-completion-screen')).toBeOnTheScreen();
      expect(screen.queryByTestId('welcome-back-screen')).toBeNull();
      expect(screen.queryByTestId('home-screen')).toBeNull();
    });

    it('renders Home as usual when no last-active session was persisted', async () => {
      stubPersistedFlags({ onboardingSeen: true, permissionHandled: true });

      await render(<App />);

      expect(await screen.findByTestId('home-screen')).toBeOnTheScreen();
      expect(mockFetchSession).not.toHaveBeenCalled();
    });
  });
});
