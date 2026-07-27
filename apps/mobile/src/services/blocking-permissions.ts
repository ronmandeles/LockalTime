import { NativeModules, Platform } from 'react-native';

// Blocking-permission service contract for Screen 2 (permission priming).
//
// Phase 3 task 3.2: swaps the Phase 1 placeholder for the real Android seam.
// apps/mobile/android/app/src/main/java/com/lockaltime/blocking/
// BlockingPermissionsModule.kt checks Usage Access (AppOpsManager) + Overlay
// (Settings.canDrawOverlays) and reports the weaker of the two as one
// combined status — the screen never sees per-platform nuance. iOS keeps the
// Phase 1 placeholder (FamilyControls arrives in task 3.6) so this module
// stays the seam PermissionPrimingScreen always coded against
// (.claude/skills/testing-standards/SKILL.md native-modules rule: JS-side
// contract test over the mocked bridge; real OS behavior is manual QA,
// docs/MANUAL_QA.md, though the Kotlin module itself is Gradle-build-verified).
//
// Neither call ever rejects: permission state is an answer, not an error.

export type BlockingPermissionStatus =
  | { readonly status: 'granted' }
  | { readonly status: 'denied' }
  | { readonly status: 'undetermined' };

export interface BlockingPermissionsService {
  getStatus(): Promise<BlockingPermissionStatus>;
  request(): Promise<BlockingPermissionStatus>;
}

interface NativeBlockingPermissionsModule {
  getStatus(): Promise<{ readonly status: unknown }>;
  request(): Promise<{ readonly status: unknown }>;
  requestBatteryOptimizationExemption(): Promise<boolean>;
}

// Read fresh on every call rather than cached at module-load time — the
// bridge registers native modules before any JS runs on a real device, but a
// live re-read (not a cached reference) keeps this resilient to module
// registration order and is what makes the module test-mockable at all.
// NativeModules isn't typed per-app; the actual response shape is validated
// below (typescript-strictness: runtime-validate everything crossing a
// native-bridge boundary), so this lookup itself is a safe structural cast.
const getNativeModule = (): NativeBlockingPermissionsModule | undefined =>
  (NativeModules as Record<string, unknown>).BlockingPermissionsModule as
    | NativeBlockingPermissionsModule
    | undefined;

const UNDETERMINED: BlockingPermissionStatus = { status: 'undetermined' };
const DENIED: BlockingPermissionStatus = { status: 'denied' };

const toStatus = (raw: { readonly status: unknown }): BlockingPermissionStatus => {
  if (raw.status === 'granted' || raw.status === 'denied' || raw.status === 'undetermined') {
    return { status: raw.status };
  }
  // Garbage/unrecognized payload from the bridge — never trust it as a grant.
  return UNDETERMINED;
};

export const blockingPermissions: BlockingPermissionsService = {
  getStatus: async (): Promise<BlockingPermissionStatus> => {
    const nativeModule = getNativeModule();
    if (Platform.OS !== 'android' || nativeModule === undefined) {
      return UNDETERMINED;
    }
    return toStatus(await nativeModule.getStatus());
  },
  request: async (): Promise<BlockingPermissionStatus> => {
    if (Platform.OS !== 'android') {
      // iOS Phase 1 placeholder: no bridge exists that could actually grant.
      return DENIED;
    }
    const nativeModule = getNativeModule();
    if (nativeModule === undefined) {
      return UNDETERMINED;
    }
    return toStatus(await nativeModule.request());
  },
};

// Battery-optimization exemption (ARCHITECTURE.md §8 item 13) is a separate,
// best-effort, non-blocking ask — Android reliability UX, not part of the
// granted/denied capability above (Android never lets an app force this, so
// it can't gate anything). Fired once after the main permission flow
// succeeds; never rejects, iOS is a no-op until it has an equivalent.
export const requestBatteryOptimizationExemption = async (): Promise<void> => {
  const nativeModule = getNativeModule();
  if (Platform.OS !== 'android' || nativeModule === undefined) {
    return;
  }
  await nativeModule.requestBatteryOptimizationExemption().catch(() => undefined);
};
