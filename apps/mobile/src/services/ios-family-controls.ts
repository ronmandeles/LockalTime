import { NativeModules, Platform } from 'react-native';

import type { BlockedCategory } from '../config/blocked-categories';
import {
  blocklistCacheKey,
  blocklistIds,
  decideSelectionStrategy,
} from './ios-blocklist-selection';

// The iOS side of joining a session (docs/BLOCKLIST_SELECTION_PLAN.md §7).
//
// The Swift module behind this is deliberately a **dumb keyed store**: a map
// of id -> ApplicationToken/ActivityCategoryToken, and a cache of
// blocklist-key -> saved selection. It has no branching logic, because
// nothing in Swift can be tested on this machine. Every decision is made
// here (ios-blocklist-selection.ts) and handed to it as an instruction.
//
// getKnownIds returns the map's KEYS ONLY. The tokens themselves cannot
// cross the bridge — they are opaque, and Apple gives no way to serialize
// them — which is also why this seam can never verify that a member picked
// correctly. Like every client-side blocking signal in this app, the server
// never treats it as trusted (ARCHITECTURE.md §5/§8).

export interface PresentPickerOptions {
  // Pre-ticked in Apple's sheet, composed from tokens we already hold.
  readonly seedIds: readonly string[];
  // The one id to learn by subtraction (newSet − oldSet), or null to learn
  // nothing. Never more than one: with two unknowns the difference is a set
  // of two tokens with no way to tell them apart, and a wrong guess would
  // poison the map permanently.
  readonly learnId: string | null;
  // Saved against the completed selection so an identical blocklist later
  // skips the picker entirely.
  readonly cacheKey: string;
  // FamilyActivityPicker accepts header and footer text, so the list of
  // what to select renders inside Apple's own UI — the member isn't working
  // from memory of the previous screen.
  readonly headerText: string;
  readonly footerText: string;
}

interface NativeIosFamilyControlsModule {
  getKnownIds(): Promise<unknown>;
  applyKnownSelection(ids: readonly string[]): Promise<unknown>;
  applyCachedSelection(cacheKey: string): Promise<unknown>;
  presentPicker(options: {
    seedIds: readonly string[];
    learnId: string | null;
    cacheKey: string;
    headerText: string;
    footerText: string;
  }): Promise<unknown>;
}

// Read fresh on every call, never cached at module load — same lesson as
// app-blocker.ts and blocking-permissions.ts.
const getNativeModule = (): NativeIosFamilyControlsModule | undefined => {
  if (Platform.OS !== 'ios') {
    return undefined;
  }
  return (NativeModules as Record<string, unknown>).IosFamilyControlsModule as
    | NativeIosFamilyControlsModule
    | undefined;
};

export type SelectionOutcome =
  // Ready to join: a selection is applied, whether from the cache, the map,
  // or a picker the member just completed.
  | 'ready'
  // The member dismissed Apple's sheet. Not joined — there is no
  // half-joined state, and markBlockerReady must not fire (plan §9).
  | 'cancelled'
  // No iOS token machinery here at all (Android, or a build without the
  // module). Android resolves everything locally, so there is nothing to
  // acquire and joining proceeds.
  | 'not_applicable';

const toBoolean = (raw: unknown): boolean => raw === true;

const toIdList = (raw: unknown): readonly string[] =>
  Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && id.length > 0) : [];

export interface PrepareSelectionParams {
  readonly categories: readonly BlockedCategory[];
  readonly packages: readonly string[];
  // Already-translated, already-formatted copy for Apple's sheet — resolved
  // by the caller, which has the i18n context and the display names.
  readonly headerText: string;
  readonly footerText: string;
}

// Acquires whatever this device needs before it can enforce the session's
// blocklist, and reports whether joining may proceed.
//
// Order matters and is deliberate:
//   1. the per-blocklist cache — "we did exactly this before", cheapest and
//      shows no UI;
//   2. the token map — more general, also shows no UI when it covers
//      everything, and can learn one new item when it nearly does;
//   3. the full picker — the fallback that always works.
export const prepareIosBlocklistSelection = async (
  params: PrepareSelectionParams,
): Promise<SelectionOutcome> => {
  const native = getNativeModule();
  if (native === undefined) {
    return 'not_applicable';
  }

  const cacheKey = blocklistCacheKey(params.categories, params.packages);
  const ids = blocklistIds(params.categories, params.packages);
  if (ids.length === 0) {
    return 'ready';
  }

  // A cached selection can silently go stale if iOS rotates the tokens
  // behind it (plan §2/§7) — undetectable by design, and accepted rather
  // than solved. It fails in the under-blocking direction, which never buys
  // anyone points they didn't earn.
  const cached = await native.applyCachedSelection(cacheKey).catch(() => false);
  if (toBoolean(cached)) {
    return 'ready';
  }

  const knownIds = toIdList(await native.getKnownIds().catch(() => []));
  const strategy = decideSelectionStrategy(ids, knownIds);

  if (strategy.kind === 'compose_from_known') {
    const applied = await native.applyKnownSelection(strategy.ids).catch(() => false);
    if (toBoolean(applied)) {
      return 'ready';
    }
    // Composition failed — most likely a rotated token the map still lists.
    // Fall through to the picker rather than joining with nothing applied.
    return presentPicker(native, {
      seedIds: [],
      learnId: null,
      cacheKey,
      headerText: params.headerText,
      footerText: params.footerText,
    });
  }

  if (strategy.kind === 'learn_one') {
    return presentPicker(native, {
      seedIds: strategy.knownIds,
      learnId: strategy.unknownId,
      cacheKey,
      headerText: params.headerText,
      footerText: params.footerText,
    });
  }

  return presentPicker(native, {
    seedIds: [],
    learnId: null,
    cacheKey,
    headerText: params.headerText,
    footerText: params.footerText,
  });
};

const presentPicker = async (
  native: NativeIosFamilyControlsModule,
  options: PresentPickerOptions,
): Promise<SelectionOutcome> => {
  const completed = await native.presentPicker(options).catch(() => false);
  // Anything other than an explicit success is treated as a cancel. Joining
  // with no selection applied would leave the member in a session enforcing
  // nothing, which is precisely the failure this whole step exists to
  // prevent.
  return toBoolean(completed) ? 'ready' : 'cancelled';
};
