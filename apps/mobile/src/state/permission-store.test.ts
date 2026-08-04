import {
  PERMISSION_STEP_HANDLED_STORAGE_KEY,
  hydratePermissionStepStatus,
  markPermissionStepHandled,
  usePermissionStore,
} from './permission-store';

// Phase 1 permission-step gating store (Screen 2), mirroring the proven
// onboarding-store contract App's gate relies on: unhandled -> permission
// priming, handled -> the rest of the app (App.spec.tsx asserts the rendering
// side). Its OWN storage key, deliberately separate from the onboarding flag:
// the two gates advance independently (a returning user who saw onboarding
// but never resolved the permission ask must land on Screen 2, not Home).
//
// Semantics pin (flagged for review): the flag records that the user has BEEN
// THROUGH the priming step — via a granted request OR the explicit
// proceed-anyway recovery — not that the permission is granted. Live grant
// state is always the blocking-permissions service's answer; nothing may read
// this flag as "blocking works" (same always-fetch-authoritative posture as
// the money rule, applied to capability state).
//
// State is a discriminated union (hydrating | ready) per
// .claude/skills/typescript-strictness/SKILL.md, so the gate cannot read an answer before
// AsyncStorage has actually been consulted. Failure policy: fail open —
// a storage read failure hydrates as unhandled and a persistence failure
// still marks handled in-memory; the worst case is one repeat of a skippable
// priming screen, while failing closed would strand the app in the gate.
// AsyncStorage is mocked virtually per the established pattern; no test
// touches real storage.

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
  usePermissionStore.setState({ permissionStep: { status: 'hydrating' } });
});

describe('usePermissionStore', () => {
  it('starts hydrating, so no gate decision can leak before storage is read', () => {
    expect(usePermissionStore.getState().permissionStep).toEqual({ status: 'hydrating' });
  });
});

describe('hydratePermissionStepStatus', () => {
  it('resolves to unhandled when no flag has ever been persisted', async () => {
    await hydratePermissionStepStatus();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: false,
    });
  });

  it('resolves to handled when the persisted flag is present', async () => {
    mockGetItem.mockResolvedValue('true');

    await hydratePermissionStepStatus();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: true,
    });
  });

  it('treats an unrecognized persisted value as unhandled', async () => {
    mockGetItem.mockResolvedValue('corrupted-value');

    await hydratePermissionStepStatus();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: false,
    });
  });

  it('falls back to unhandled when the storage read fails, never stranding the gate', async () => {
    mockGetItem.mockRejectedValue(new Error('storage unavailable'));

    await hydratePermissionStepStatus();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: false,
    });
  });

  it('reads the pinned storage key', async () => {
    await hydratePermissionStepStatus();

    expect(mockGetItem).toHaveBeenCalledTimes(1);
    expect(mockGetItem).toHaveBeenCalledWith(PERMISSION_STEP_HANDLED_STORAGE_KEY);
  });
});

describe('markPermissionStepHandled', () => {
  it('marks the permission step handled in the store', async () => {
    await markPermissionStepHandled();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: true,
    });
  });

  it("persists 'true' under the pinned storage key", async () => {
    await markPermissionStepHandled();

    expect(mockSetItem).toHaveBeenCalledTimes(1);
    expect(mockSetItem).toHaveBeenCalledWith(PERMISSION_STEP_HANDLED_STORAGE_KEY, 'true');
  });

  it('still marks handled in-memory when persistence fails', async () => {
    mockSetItem.mockRejectedValue(new Error('disk full'));

    // Must resolve (not reject): a persistence failure costs one repeat of
    // the priming screen on some future launch, never a crash or a stuck
    // gate now.
    await expect(markPermissionStepHandled()).resolves.toBeUndefined();

    expect(usePermissionStore.getState().permissionStep).toEqual({
      status: 'ready',
      hasHandledPermissionStep: true,
    });
  });

  it('notifies subscribers, so the App gate re-renders when the step completes', async () => {
    const listener = jest.fn();
    const unsubscribe = usePermissionStore.subscribe(listener);

    await markPermissionStepHandled();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });
});

describe('PERMISSION_STEP_HANDLED_STORAGE_KEY', () => {
  it('pins the key literal — renaming it would silently orphan every persisted flag', () => {
    expect(PERMISSION_STEP_HANDLED_STORAGE_KEY).toBe('@lockal-time/permission-step-handled');
  });
});
