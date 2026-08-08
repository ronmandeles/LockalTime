import { useEffect, useMemo, useRef, useState } from 'react';

import { useTranslation } from 'react-i18next';

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
  // Phase 9: these now come off the hydrated session row, which is a fresh
  // object on every realtime update — so a caller CANNOT hand over a stable
  // reference even if it wants to. The hook therefore stabilizes them
  // itself, by content, below. Before this the contract was "pass a stable
  // reference or the blocker restarts every render", which was a trap with
  // no compiler behind it.
  readonly blockedCategories: readonly BlockedCategory[];
  readonly blockedPackages: readonly string[];
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
  const { sessionId, isSessionActive, endsAt, module = appBlocker } = params;
  const { t } = useTranslation();
  const [violation, setViolation] = useState<BlockerViolation | null>(null);

  // Stabilized by CONTENT, not identity. The session row is re-created on
  // every realtime update, so depending on the array reference would tear
  // the blocker down and restart it — lifting the shield for a moment —
  // every time anything about the session changed.
  const categoriesKey = params.blockedCategories.join(',');
  const packagesKey = params.blockedPackages.join(',');
  const blockedCategories = useMemo(
    () => params.blockedCategories,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [categoriesKey],
  );
  const blockedPackages = useMemo(
    () => params.blockedPackages,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [packagesKey],
  );

  // The overlay is a bare native TextView with no i18next of its own
  // (plan §8), so the resolved copy is handed to it at start() and it
  // formats in the app's name. One translation source of truth rather than
  // a parallel set of Android string resources needing their own values-iw.
  const overlayCopy = useMemo(
    () => ({
      blockedApp: t('blocker.overlay.blockedApp'),
      blockedGeneric: t('blocker.overlay.blockedGeneric'),
    }),
    [t],
  );

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
      .start({
        sessionId: activeSessionId,
        endsAt,
        blockedCategories,
        blockedPackages,
        overlayCopy,
      })
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
  }, [sessionId, isSessionActive, endsAt, blockedCategories, blockedPackages, overlayCopy, module]);

  return { violation };
};
