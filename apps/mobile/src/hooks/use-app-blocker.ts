import { useEffect, useRef, useState } from 'react';

import type { BlockedCategory } from '../config/blocked-categories';
import { markBlockerReady } from '../services/api-client';
import { appBlocker } from '../services/app-blocker';
import type { AppBlockerModule, BlockerStatus } from '../services/app-blocker';

// Narrows BlockerStatus to just the 'violation' shape — violation is only
// ever set to this shape or null below, and callers (e.g.
// ActiveSessionScreen) need `.reason` without re-narrowing a wider union.
export type BlockerViolation = Extract<BlockerStatus, { readonly state: 'violation' }>;

// Phase 3 task 3.1 (backlog.md): reconciles native blocker events with
// session state, per ARCHITECTURE.md §4's `useAppBlocker` bridge pattern.
// Owns the module's start/stop lifecycle off session state — never a screen
// or useSession itself, matching the seam pattern elsewhere in this repo.

export interface UseAppBlockerParams {
  readonly sessionId: string | null;
  readonly isSessionActive: boolean;
  // Absolute server timestamp, or null for open-ended — forwarded to
  // AppBlockerModule.start() as-is (app-blocker.ts's SessionBlockerConfig).
  readonly endsAt: string | null;
  // Pass a stable reference (e.g. the BLOCKED_CATEGORIES module constant) —
  // it's an effect dependency, so a freshly-allocated array every render
  // would restart the blocker every render.
  readonly blockedCategories: readonly BlockedCategory[];
  // native-enforced 30-min offline cutoff surfaced as an event
  // (app-blocker.ts's offline_cutoff_reached) — this hook only forwards it;
  // the caller wires it to useSession's reportOfflineTimeout.
  readonly onOfflineTimeout: () => void;
  // Test seam: defaults to the real singleton.
  readonly module?: AppBlockerModule;
}

export interface UseAppBlockerResult {
  // Non-null only while a violation is active. permission_revoked /
  // service_killed / battery_critical are faults (ARCHITECTURE.md §8 items
  // 1-2, 13); shield_triggered is blocking working as intended, so it never
  // sets this.
  readonly violation: BlockerViolation | null;
}

export const useAppBlocker = (params: UseAppBlockerParams): UseAppBlockerResult => {
  const { sessionId, isSessionActive, endsAt, blockedCategories, module = appBlocker } = params;
  const [violation, setViolation] = useState<BlockerViolation | null>(null);

  // Stable ref so the effect below doesn't need onOfflineTimeout as a
  // dependency — callers (e.g. a screen composing useSession + this hook)
  // would otherwise recreate it every render and restart the blocker.
  const onOfflineTimeoutRef = useRef(params.onOfflineTimeout);
  onOfflineTimeoutRef.current = params.onOfflineTimeout;

  useEffect(() => {
    if (sessionId === null || !isSessionActive) {
      return undefined;
    }

    const activeSessionId = sessionId;
    // Reports blocker-ready only once start() genuinely resolves — never on
    // a failed start, and never awaited/surfaced to the caller (ARCHITECTURE.md
    // §7's Sybil-resistance gate is advisory: a failure here only costs this
    // participant the Group Bonus threshold, never their place in the session).
    module
      .start({ sessionId: activeSessionId, endsAt, blockedCategories })
      .then(() => {
        markBlockerReady(activeSessionId).catch(() => undefined);
      })
      .catch(() => undefined);

    const unsubscribe = module.addEventListener((event) => {
      switch (event.type) {
        case 'offline_cutoff_reached':
          onOfflineTimeoutRef.current();
          break;
        case 'permission_revoked':
        case 'service_killed':
        case 'battery_critical':
          setViolation({ state: 'violation', sessionId: event.sessionId, reason: event.type });
          break;
        case 'shield_triggered':
          break;
      }
    });

    return () => {
      unsubscribe();
      module.stop().catch(() => undefined);
    };
  }, [sessionId, isSessionActive, endsAt, blockedCategories, module]);

  return { violation };
};
