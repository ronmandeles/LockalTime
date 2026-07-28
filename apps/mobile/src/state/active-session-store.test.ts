import {
  ACTIVE_SESSION_STORAGE_KEY,
  clearActiveSession,
  hydrateActiveSessionStatus,
  resolveWelcomeBack,
  setActiveSession,
  useActiveSessionStore,
} from './active-session-store';

// Phase 4 task 12 — Screen 13 (Welcome Back). Mirrors onboarding-store.ts's
// pattern exactly: a discriminated hydrating/ready union so the App gate
// can never decide "show Welcome Back or not" before AsyncStorage has
// actually been consulted (typescript-strictness skill). Persists only the
// session id that was last active — never any money-equivalent data,
// consistent with the Money-Equivalent Logic Rule (CLAUDE.md); "was this
// session id last active" is a device-local UX hint, not a rewards claim.
//
// pendingWelcomeBackNavigation is deliberately NOT persisted: it only
// exists to hand the resolved WelcomeBackScreen outcome (rejoin vs.
// completed) to App.tsx for the one NavigationContainer mount that follows
// it, and self-resets on every cold start.

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

const SESSION_ID = '77777777-7777-7777-7777-777777777777';

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockRemoveItem.mockReset();
  mockRemoveItem.mockResolvedValue(undefined);
  mockSetItem.mockReset();
  mockSetItem.mockResolvedValue(undefined);
  useActiveSessionStore.setState({
    activeSession: { status: 'hydrating' },
    pendingWelcomeBackNavigation: null,
  });
});

describe('useActiveSessionStore', () => {
  it('starts hydrating, so the App gate cannot decide before storage is read', () => {
    expect(useActiveSessionStore.getState().activeSession).toEqual({ status: 'hydrating' });
  });
});

describe('hydrateActiveSessionStatus', () => {
  it('resolves to no last-active session when nothing has ever been persisted', async () => {
    await hydrateActiveSessionStatus();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: null,
    });
  });

  it('resolves to the persisted session id when one exists', async () => {
    mockGetItem.mockResolvedValue(SESSION_ID);

    await hydrateActiveSessionStatus();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: SESSION_ID,
    });
  });

  it('falls back to no last-active session when the storage read fails, never stranding the gate', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await hydrateActiveSessionStatus();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: null,
    });
  });

  it('reads the pinned storage key', async () => {
    await hydrateActiveSessionStatus();

    expect(mockGetItem).toHaveBeenCalledWith(ACTIVE_SESSION_STORAGE_KEY);
  });
});

describe('setActiveSession', () => {
  it('persists the session id and updates the store', async () => {
    await setActiveSession(SESSION_ID);

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: SESSION_ID,
    });
    expect(mockSetItem).toHaveBeenCalledWith(ACTIVE_SESSION_STORAGE_KEY, SESSION_ID);
  });

  it('still updates the store in-memory when persistence fails', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));

    await expect(setActiveSession(SESSION_ID)).resolves.toBeUndefined();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: SESSION_ID,
    });
  });
});

describe('clearActiveSession', () => {
  it('clears the persisted flag and the store', async () => {
    await setActiveSession(SESSION_ID);

    await clearActiveSession();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: null,
    });
    expect(mockRemoveItem).toHaveBeenCalledWith(ACTIVE_SESSION_STORAGE_KEY);
  });

  it('still clears the store in-memory when persistence fails', async () => {
    mockRemoveItem.mockRejectedValue(new Error('disk full'));

    await expect(clearActiveSession()).resolves.toBeUndefined();

    expect(useActiveSessionStore.getState().activeSession).toEqual({
      status: 'ready',
      lastActiveSessionId: null,
    });
  });
});

describe('resolveWelcomeBack', () => {
  it('sets the pending navigation for App.tsx to consume, without touching persisted storage', () => {
    resolveWelcomeBack({ screen: 'SessionDetails', sessionId: SESSION_ID });

    expect(useActiveSessionStore.getState().pendingWelcomeBackNavigation).toEqual({
      screen: 'SessionDetails',
      sessionId: SESSION_ID,
    });
    expect(mockSetItem).not.toHaveBeenCalled();
    expect(mockRemoveItem).not.toHaveBeenCalled();
  });

  it('accepts null to resolve into the default (Home) flow', () => {
    resolveWelcomeBack({ screen: 'SessionCompletion', sessionId: SESSION_ID });

    resolveWelcomeBack(null);

    expect(useActiveSessionStore.getState().pendingWelcomeBackNavigation).toBeNull();
  });
});
