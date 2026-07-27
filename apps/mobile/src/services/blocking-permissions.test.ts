const mockGetStatus = jest.fn();
const mockRequest = jest.fn();
const mockRequestBatteryOptimizationExemption = jest.fn();

import { NativeModules, Platform } from 'react-native';

// NativeModules/Platform come from the RN jest preset's own mock — mutated
// in place rather than replaced via jest.mock('react-native', ...), which
// would eagerly re-evaluate the whole real module (including native-only
// registries like DevMenu that don't exist outside a real app binary).
(NativeModules as Record<string, unknown>).BlockingPermissionsModule = {
  getStatus: (...args: unknown[]) => mockGetStatus(...args),
  request: (...args: unknown[]) => mockRequest(...args),
  requestBatteryOptimizationExemption: (...args: unknown[]) =>
    mockRequestBatteryOptimizationExemption(...args),
};

import { blockingPermissions, requestBatteryOptimizationExemption } from './blocking-permissions';

// Phase 3 task 3.2 (backlog.md): swaps the Phase 1 placeholder for the real
// Android seam — apps/mobile/android/app/src/main/java/com/lockaltime/blocking/
// BlockingPermissionsModule.kt checks Usage Access (AppOpsManager) + Overlay
// (Settings.canDrawOverlays) and reports the weaker of the two, matching the
// "one combined status, weakest link" contract this module has always
// pinned. iOS keeps the Phase 1 placeholder behavior until task 3.6 wires
// FamilyControls — this suite pins both branches. NativeModules is mocked
// (no real bridge in Jest); the real OS behavior is manual QA
// (docs/MANUAL_QA.md), but the Kotlin module is real and Gradle-build-verified.

const setPlatform = (os: 'android' | 'ios'): void => {
  (Platform as unknown as { OS: string }).OS = os;
};

describe('blockingPermissions on Android', () => {
  beforeEach(() => {
    setPlatform('android');
    mockGetStatus.mockReset();
    mockRequest.mockReset();
    mockRequestBatteryOptimizationExemption.mockReset();
  });

  it('getStatus forwards a granted native result', async () => {
    mockGetStatus.mockResolvedValue({ status: 'granted' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'granted' });
  });

  it('getStatus forwards a denied native result (the weakest-link report)', async () => {
    mockGetStatus.mockResolvedValue({ status: 'denied' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'denied' });
  });

  it('getStatus falls back to undetermined for a garbage native payload — boundary validation', async () => {
    mockGetStatus.mockResolvedValue({ status: 'not-a-real-status' });

    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'undetermined' });
  });

  it('request forwards the native request outcome', async () => {
    mockRequest.mockResolvedValue({ status: 'undetermined' });

    await expect(blockingPermissions.request()).resolves.toEqual({ status: 'undetermined' });

    expect(mockRequest).toHaveBeenCalledTimes(1);
  });

  it('requestBatteryOptimizationExemption calls the native module and never throws', async () => {
    mockRequestBatteryOptimizationExemption.mockResolvedValue(true);

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
    expect(mockRequestBatteryOptimizationExemption).toHaveBeenCalledTimes(1);
  });

  it('requestBatteryOptimizationExemption swallows a native rejection — best-effort, never blocks', async () => {
    mockRequestBatteryOptimizationExemption.mockRejectedValue(new Error('unavailable'));

    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
  });
});

describe('blockingPermissions on iOS (Phase 1 placeholder, until task 3.6)', () => {
  beforeEach(() => {
    setPlatform('ios');
    mockRequestBatteryOptimizationExemption.mockReset();
  });

  it("getStatus resolves 'undetermined' — no FamilyControls bridge yet", async () => {
    await expect(blockingPermissions.getStatus()).resolves.toEqual({ status: 'undetermined' });
  });

  it("request resolves 'denied' — no bridge exists that could actually grant", async () => {
    await expect(blockingPermissions.request()).resolves.toEqual({ status: 'denied' });
  });

  it('requestBatteryOptimizationExemption is a no-op — Android-only concept', async () => {
    await expect(requestBatteryOptimizationExemption()).resolves.toBeUndefined();
    expect(mockRequestBatteryOptimizationExemption).not.toHaveBeenCalled();
  });
});
