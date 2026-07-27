import { NativeModules, Platform } from 'react-native';

// Blocking-permission service contract for Screen 2 (permission priming).
//
// Phase 3 tasks 3.2 (Android) / 3.6 (iOS) both swap in a real native module
// under the SAME name, `BlockingPermissionsModule`, each reporting the same
// `{ status }` shape — so this module needs no Platform.OS branching at
// all for getStatus/request: it just calls whichever native module is
// actually registered.
// - Android: apps/mobile/android/.../blocking/BlockingPermissionsModule.kt
//   checks Usage Access (AppOpsManager) + Overlay (Settings.canDrawOverlays).
//   Gradle-build-verified.
// - iOS: apps/mobile/ios/LockalTime/Blocking/BlockingPermissionsModule.swift
//   checks FamilyControls authorization + a saved category selection (the
//   FamilyActivityPicker flow). Written but NOT compiled or linked into the
//   Xcode project yet (no Mac) — see that file's header and
//   docs/MANUAL_QA.md's iOS extension target setup.
// Until either is actually wired into a running build, NativeModules.
// BlockingPermissionsModule is undefined and the fallbacks below apply —
// this is today's real state on both platforms in this repo, not a
// deliberate placeholder distinction anymore (.claude/skills/testing-standards/SKILL.md
// native-modules rule: JS-side contract test over the mocked bridge; real
// OS behavior is manual QA, docs/MANUAL_QA.md).
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
    if (nativeModule === undefined) {
      return UNDETERMINED;
    }
    return toStatus(await nativeModule.getStatus());
  },
  request: async (): Promise<BlockingPermissionStatus> => {
    const nativeModule = getNativeModule();
    if (nativeModule === undefined) {
      // No bridge registered on this build yet — an answer, not a retry
      // invitation, since nothing here could actually change on a retry.
      return DENIED;
    }
    return toStatus(await nativeModule.request());
  },
};

// Battery-optimization exemption (ARCHITECTURE.md §8 item 13) is a separate,
// best-effort, non-blocking ask — Android reliability UX, not part of the
// granted/denied capability above (Android never lets an app force this, so
// it can't gate anything). Fired once after the main permission flow
// succeeds. Android-only concept: iOS has no equivalent setting, not just
// "not implemented yet" — never rejects either way.
export const requestBatteryOptimizationExemption = async (): Promise<void> => {
  if (Platform.OS !== 'android') {
    return;
  }
  const nativeModule = getNativeModule();
  if (nativeModule === undefined) {
    return;
  }
  await nativeModule.requestBatteryOptimizationExemption().catch(() => undefined);
};
