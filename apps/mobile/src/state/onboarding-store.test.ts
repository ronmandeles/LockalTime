import {
  ONBOARDING_SEEN_STORAGE_KEY,
  hydrateOnboardingStatus,
  markOnboardingSeen,
  useOnboardingStore,
} from './onboarding-store';

// Phase 1 first-launch gating store (Screen 1). Pins the contract App's gate
// relies on: unseen -> onboarding, seen -> home, completing/skipping marks
// seen (App.spec.tsx asserts the rendering side). State is a discriminated
// union (hydrating | ready) per .claude/skills/typescript-strictness/SKILL.md, so the gate
// cannot read a seen/unseen answer before AsyncStorage has actually been
// consulted — a boolean default here would flash the wrong screen on cold
// start.
//
// Failure policy (derivable, not a product decision): storage errors fall
// back to unseen and persistence failures still mark seen in-memory — the
// worst case of failing open is a returning user seeing onboarding once more,
// while failing closed would strand the app in the gate. AsyncStorage is
// mocked virtually per the established pattern (supabase-client.test.ts); no
// test touches real storage.

const mockGetItem = jest.fn<Promise<string | null>, [string]>();
const mockRemoveItem = jest.fn<Promise<void>, [string]>();
const mockSetItem = jest.fn<Promise<void>, [string, string]>();

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: (key: string) => mockGetItem(key),
    removeItem: (key: string) => mockRemoveItem(key),
    setItem: (key: string, value: string) => mockSetItem(key, value),
  },
}));

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockResolvedValue(null);
  mockRemoveItem.mockReset();
  mockRemoveItem.mockResolvedValue(undefined);
  mockSetItem.mockReset();
  mockSetItem.mockResolvedValue(undefined);
  useOnboardingStore.setState({ onboarding: { status: 'hydrating' } });
});

describe('useOnboardingStore', () => {
  it('starts hydrating, so no gate decision can leak before storage is read', () => {
    expect(useOnboardingStore.getState().onboarding).toEqual({ status: 'hydrating' });
  });
});

describe('hydrateOnboardingStatus', () => {
  it('resolves to unseen when no flag has ever been persisted', async () => {
    await hydrateOnboardingStatus();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: false,
    });
  });

  it('resolves to seen when the persisted flag is present', async () => {
    mockGetItem.mockResolvedValue('true');

    await hydrateOnboardingStatus();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: true,
    });
  });

  it('treats an unrecognized persisted value as unseen', async () => {
    mockGetItem.mockResolvedValue('corrupted-value');

    await hydrateOnboardingStatus();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: false,
    });
  });

  it('falls back to unseen when the storage read fails, never stranding the gate', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await hydrateOnboardingStatus();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: false,
    });
  });

  it('reads the pinned storage key', async () => {
    await hydrateOnboardingStatus();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem).toHaveBeenCalledWith(ONBOARDING_SEEN_STORAGE_KEY);
  });
});

describe('markOnboardingSeen', () => {
  it('marks onboarding seen in the store', async () => {
    await markOnboardingSeen();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: true,
    });
  });

  it("persists 'true' under the pinned storage key", async () => {
    await markOnboardingSeen();

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(ONBOARDING_SEEN_STORAGE_KEY, 'true');
  });

  it('still marks seen in-memory when persistence fails', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));

    // Must resolve (not reject): a persistence failure costs one repeat of
    // onboarding on some future launch, never a crash or a stuck gate now.
    await expect(markOnboardingSeen()).resolves.toBeUndefined();

    expect(useOnboardingStore.getState().onboarding).toEqual({
      status: 'ready',
      hasSeenOnboarding: true,
    });
  });

  it('notifies subscribers, so the App gate re-renders when onboarding completes', async () => {
    const listener = jest.fn();
    const unsubscribe = useOnboardingStore.subscribe(listener);

    await markOnboardingSeen();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('ONBOARDING_SEEN_STORAGE_KEY', () => {
  it('pins the key literal — renaming it would silently orphan every persisted flag', () => {
    expect(ONBOARDING_SEEN_STORAGE_KEY).toBe('@lockal-time/onboarding-seen');
  });
});
