import type { BlockedCategory } from '../config/blocked-categories';

// AppBlockerModule seam for the native blocker bridge (ARCHITECTURE.md §4,
// Phase 3 task 3.0 — backlog.md). The REAL start/stop/poll behavior is
// native (Android Foreground Service + UsageStatsManager + overlay; iOS
// FamilyControls + ManagedSettings + DeviceActivityMonitor) and lands with
// tasks 3.3 (Android) / 3.6 (iOS). This module is the SEAM: useAppBlocker
// (task 3.1) and any screen code against this surface only, so those tasks
// swap the implementation below without touching a call site — same pattern
// as blocking-permissions.ts (Phase 1 -> Phase 3 swap).
//
// PHASE 3.0 PLACEHOLDER, deliberately deterministic pure JS:
// - start()/stop() no-op and resolve — nothing native exists yet to start or
//   stop.
// - getStatus() always resolves { state: 'inactive' } — the placeholder
//   cannot actually enforce a block, so it must never claim 'active'.
// - addEventListener() registers the listener and returns an unsubscribe
//   function, but never invokes it — no native bridge exists yet to emit
//   BlockerEvents from.
// - No call ever rejects: like blockingPermissions, capability state is an
//   answer, not an error.

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
  | { readonly type: 'battery_critical'; readonly sessionId: string; readonly level: number };

export interface AppBlockerModule {
  start(config: SessionBlockerConfig): Promise<void>;
  stop(): Promise<void>;
  getStatus(): Promise<BlockerStatus>;
  // Returns an unsubscribe function, safe to call more than once.
  addEventListener(listener: (event: BlockerEvent) => void): () => void;
}

export const appBlocker: AppBlockerModule = {
  start: async (): Promise<void> => {},
  stop: async (): Promise<void> => {},
  getStatus: async (): Promise<BlockerStatus> => ({ state: 'inactive' }),
  addEventListener: (): (() => void) => (): void => {},
};
