import { DeviceEventEmitter, NativeEventEmitter, NativeModules, Platform } from 'react-native';

import type { BlockedCategory } from '../config/blocked-categories';

// AppBlockerModule seam for the native blocker bridge (ARCHITECTURE.md §4).
// Both platforms register a real native module under the same name,
// AppBlockerModule, with the same start/stop/getStatus shape — Phase 3 task
// 3.3 (Android: BlockerForegroundService.kt, Gradle-build-verified) and
// task 3.6 (iOS: ManagedSettingsStore + DeviceActivityMonitor, written but
// not yet linked into the Xcode project — no Mac). So start/stop/getStatus
// need no Platform.OS branching, same simplification as
// blocking-permissions.ts. Event *delivery* genuinely differs per platform
// though, not just "not implemented yet": Android's Kotlin module emits via
// the shared RCTDeviceEventEmitter (no NativeEventEmitter wrapper needed —
// its addListener/removeListeners are bridge bookkeeping only), while iOS's
// Swift module is an RCTEventEmitter subclass, which JS must wrap in its
// own NativeEventEmitter instance to subscribe to.
//
// Every call reads the native module fresh at CALL time (not cached at
// module-load time) — same lesson as blocking-permissions.ts: caching a
// reference in a top-level const makes the seam unmockable in Jest, since
// imports execute before any later test-file mutation of NativeModules.

export interface SessionBlockerConfig {
  readonly sessionId: string;
  // Absolute server-issued timestamp (ISO 8601), or null for an open-ended
  // session (no self-timeout — only the 30-min offline cutoff or an
  // explicit stop() ends it). Never "now + duration": the native layer must
  // never trust the device clock alone for its own end time
  // (ARCHITECTURE.md §8 item 5).
  readonly endsAt: string | null;
  readonly blockedCategories: readonly BlockedCategory[];
}

export type BlockerStatus =
  | { readonly state: 'inactive' }
  | { readonly state: 'active'; readonly sessionId: string }
  | {
      readonly state: 'violation';
      readonly sessionId: string;
      readonly reason: 'permission_revoked' | 'service_killed' | 'battery_critical';
    };

// Mirrors ARCHITECTURE.md §4's bridge pattern event set. Broadcast-style,
// UI-hint only — never trusted for anything that affects points (that stays
// server-observed presence, per ARCHITECTURE.md §5/§8).
export type BlockerEvent =
  | {
      readonly type: 'shield_triggered';
      readonly sessionId: string;
      readonly category: BlockedCategory;
      readonly at: string;
    }
  | { readonly type: 'service_killed'; readonly sessionId: string; readonly lastSeenAt: string }
  | {
      readonly type: 'permission_revoked';
      readonly sessionId: string;
      readonly permission: 'usage_access' | 'overlay' | 'family_controls' | 'battery_optimization';
    }
  | { readonly type: 'battery_critical'; readonly sessionId: string; readonly level: number }
  // The native layer self-enforces the 30-minute offline cutoff
  // (ARCHITECTURE.md §4 "Offline mode") and emits this once it fires; JS
  // only surfaces the result — useAppBlocker forwards it into the session
  // machine's OFFLINE_TIMEOUT event (session-lifecycle-machine.ts), never
  // re-derives the cutoff itself.
  | { readonly type: 'offline_cutoff_reached'; readonly sessionId: string; readonly lastConnectedAt: string };

export interface AppBlockerModule {
  start(config: SessionBlockerConfig): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<BlockerStatus>;
  // Returns an unsubscribe function, safe to call more than once.
  addEventListener(listener: (event: BlockerEvent) => void): () => void;
}

interface NativeAppBlockerStartConfig {
  readonly sessionId: string;
  readonly endsAt: string | null;
  readonly blockedCategories: string[];
}

interface NativeAppBlockerModule {
  start(config: NativeAppBlockerStartConfig): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<unknown>;
}

// Read fresh on every call, never cached — see the file header note.
const getNativeModule = (): NativeAppBlockerModule | undefined =>
  (NativeModules as Record<string, unknown>).AppBlockerModule as NativeAppBlockerModule | undefined;

const VIOLATION_REASONS = ['permission_revoked', 'service_killed', 'battery_critical'] as const;
const BLOCKED_CATEGORY_VALUES = ['social', 'games', 'entertainment'] as const;
const PERMISSION_VALUES = ['usage_access', 'overlay', 'family_controls', 'battery_optimization'] as const;

// Runtime-validates whatever the native bridge sends back — never trust a
// bridge payload as already-typed (typescript-strictness: boundary
// validation on native-module data). An unrecognized shape always resolves
// to the safest reading, never a false 'active'/'granted'-shaped claim.
const toBlockerStatus = (raw: unknown): BlockerStatus => {
  if (typeof raw !== 'object' || raw === null) {
    return { state: 'inactive' };
  }
  const value = raw as Record<string, unknown>;
  if (value.state === 'active' && typeof value.sessionId === 'string') {
    return { state: 'active', sessionId: value.sessionId };
  }
  if (
    value.state === 'violation' &&
    typeof value.sessionId === 'string' &&
    typeof value.reason === 'string' &&
    (VIOLATION_REASONS as readonly string[]).includes(value.reason)
  ) {
    return {
      state: 'violation',
      sessionId: value.sessionId,
      reason: value.reason as 'permission_revoked' | 'service_killed' | 'battery_critical',
    };
  }
  return { state: 'inactive' };
};

const toBlockerEvent = (eventName: string, payload: unknown): BlockerEvent | null => {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const value = payload as Record<string, unknown>;
  const sessionId = value.sessionId;
  if (typeof sessionId !== 'string') {
    return null;
  }

  switch (eventName) {
    case 'shield_triggered':
      if (
        typeof value.category === 'string' &&
        (BLOCKED_CATEGORY_VALUES as readonly string[]).includes(value.category) &&
        typeof value.at === 'string'
      ) {
        return {
          type: 'shield_triggered',
          sessionId,
          category: value.category as BlockedCategory,
          at: value.at,
        };
      }
      return null;
    case 'service_killed':
      return typeof value.lastSeenAt === 'string'
        ? { type: 'service_killed', sessionId, lastSeenAt: value.lastSeenAt }
        : null;
    case 'permission_revoked':
      return typeof value.permission === 'string' &&
        (PERMISSION_VALUES as readonly string[]).includes(value.permission)
        ? {
            type: 'permission_revoked',
            sessionId,
            permission: value.permission as (typeof PERMISSION_VALUES)[number],
          }
        : null;
    case 'battery_critical':
      return typeof value.level === 'number' ? { type: 'battery_critical', sessionId, level: value.level } : null;
    case 'offline_cutoff_reached':
      return typeof value.lastConnectedAt === 'string'
        ? { type: 'offline_cutoff_reached', sessionId, lastConnectedAt: value.lastConnectedAt }
        : null;
    default:
      return null;
  }
};

const EVENT_NAMES = [
  'shield_triggered',
  'service_killed',
  'permission_revoked',
  'battery_critical',
  'offline_cutoff_reached',
] as const;

export const appBlocker: AppBlockerModule = {
  start: async (config: SessionBlockerConfig): Promise<void> => {
    const native = getNativeModule();
    if (native === undefined) {
      // No native module registered on this build yet — fail-open, never
      // crash (matches blocking-permissions.ts's posture).
      return;
    }
    await native.start({
      sessionId: config.sessionId,
      endsAt: config.endsAt,
      blockedCategories: [...config.blockedCategories],
    });
  },

  stop: async (): Promise<void> => {
    const native = getNativeModule();
    if (native === undefined) {
      return;
    }
    await native.stop();
  },

  getStatus: async (): Promise<BlockerStatus> => {
    const native = getNativeModule();
    if (native === undefined) {
      return { state: 'inactive' };
    }
    return toBlockerStatus(await native.getStatus());
  },

  addEventListener: (listener: (event: BlockerEvent) => void): (() => void) => {
    const native = getNativeModule();
    if (native === undefined) {
      return (): void => {};
    }

    if (Platform.OS === 'android') {
      const subscriptions = EVENT_NAMES.map((eventName) =>
        DeviceEventEmitter.addListener(eventName, (payload: unknown) => {
          const event = toBlockerEvent(eventName, payload);
          if (event !== null) {
            listener(event);
          }
        }),
      );
      return (): void => {
        subscriptions.forEach((subscription) => subscription.remove());
      };
    }

    // iOS: AppBlockerModule.swift is an RCTEventEmitter subclass — JS must
    // wrap it in its own NativeEventEmitter to subscribe (unlike Android's
    // shared DeviceEventEmitter above).
    const emitter = new NativeEventEmitter(native as never);
    const subscriptions = EVENT_NAMES.map((eventName) =>
      emitter.addListener(eventName, (payload: unknown) => {
        const event = toBlockerEvent(eventName, payload);
        if (event !== null) {
          listener(event);
        }
      }),
    );
    return (): void => {
      subscriptions.forEach((subscription) => subscription.remove());
    };
  },
};
