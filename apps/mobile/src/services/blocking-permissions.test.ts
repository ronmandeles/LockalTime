const mockGetStatus = jest.fn();
const mockRequest = jest.fn();
const mockRequestBatteryOptimizationExemption = jest.fn();

import { NativeModules, Platform } from 'react-native';

// NativeModules/Platform come from the RN jest preset's own mock — mutated
// in place rather than replaced via jest.mock('react-native', ...), which
// would eagerly re-evaluate the whole real module (including native-only
// registries like DevMenu that don't exist outside a real app binary).
const NATIVE_MODULE_STUB = {
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  request: (...args: unknown[]) => mockRequest(...args),
  requestBatteryOptimizationExemption: (...args: unknown[]) =>
    mockRequestBatteryOptimizationExemption(...args),
};

import { blockingPermissions, requestBatteryOptimizationExemption } from './blocking-permissions';

// Phase 3 tasks 3.2 (Android) / 3.6 (iOS): both platforms register a real
// native module under the same name, BlockingPermissionsModule, reporting
// the same { status } shape — so getStatus/request need no Platform.OS
// branching at all, just "is a module registered." This suite pins that
// generic path (with Android's Kotlin module Gradle-build-verified, and
// iOS's Swift module written but not yet linked into the Xcode project —
// see blocking-permissions.ts's header), plus the still-platform-gated
// requestBatteryOptimizationExemption (an Android-only concept, not just
// "not implemented on iOS yet"). NativeModules is mocked (no real bridge in
// Jest); the real OS behavior is manual QA (docs/MANUAL_QA.md).

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

describe('blockingPermissions with a native module registered', () => {
  beforeEach(() => {
    (NativeModules as Record<string, unknown>).BlockingPermissionsModule = NATIVE_MODULE_STUB;
    mockGetStatus.mockReset();
    mockRequest.mockReset();
  });

  it.each(['android', 'ios'] as const)('getStatus forwards a granted native result on %s', async (os) => {
    setPlatform(os);
    mockGetStatus.mockResolvedValue({ status: 'granted' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'granted' });
  });

  it('getStatus forwards a denied native result (the weakest-link report)', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({ status: 'denied' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'denied' });
  });

  it('getStatus falls back to undetermined for a garbage native payload — boundary validation', async () => {
    setPlatform('android');
    mockGetStatus.mockResolvedValue({ status: 'not-a-real-status' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'undetermined' });
  });

  it.each(['android', 'ios'] as const)('request forwards the native request outcome on %s', async (os) => {
    setPlatform(os);
    mockRequest.mockResolvedValue({ status: 'undetermined' });

    await expect(blockingPermissions.request()).resolves.toEqual({ status: 'undetermined' });
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
});

describe('blockingPermissions with no native module registered (today\'s real state until a build links one)', () => {
  beforeEach(() => {
    delete (NativeModules as Record<string, unknown>).BlockingPermissionsModule;
  });

  it("getStatus resolves 'undetermined' on either platform", async () => {
    setPlatform('android');
    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'undetermined' });

    setPlatform('ios');
    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'undetermined' });
  });

  it("request resolves 'denied' on either platform — nothing a retry could change", async () => {
    setPlatform('android');
    await expect(blockingPermissions.request()).resolves.toEqual({ status: 'denied' });

    setPlatform('ios');
    await expect(blockingPermissions.request()).resolves.toEqual({ status: 'denied' });
  });
});

describe('requestBatteryOptimizationExemption (Android-only concept)', () => {
  beforeEach(() => {
    (NativeModules as Record<string, unknown>).BlockingPermissionsModule = NATIVE_MODULE_STUB;
    mockRequestBatteryOptimizationExemption.mockReset();
  });

  it('calls the native module and never throws on Android', async () => {
    setPlatform('android');
    mockRequestBatteryOptimizationExemption.mockResolvedValue(true);

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
    expect(mockRequestBatteryOptimizationExemption).toHaveBeenCalledTimes(1);
  });

  it('swallows a native rejection — best-effort, never blocks', async () => {
    setPlatform('android');
    mockRequestBatteryOptimizationExemption.mockRejectedValue(new Error('unavailable'));

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
  });

  it('is a no-op on iOS regardless of whether a module is registered', async () => {
    setPlatform('ios');

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
    expect(mockRequestBatteryOptimizationExemption).not.toHaveBeenCalled();
  });
});
