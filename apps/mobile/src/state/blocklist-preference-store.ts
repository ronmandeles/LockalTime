import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

import {
  DEFAULT_BLOCKED_CATEGORIES,
  isBlockedCategory,
  type BlockedCategory,
} from '../config/blocked-categories';

// The host's last blocklist choice, remembered so Create Session pre-fills
// what they picked last time instead of starting from scratch every session
// (docs/BLOCKLIST_SELECTION_PLAN.md §7). Mirrors active-session-store.ts's
// hydrating/ready gate and its fail-open policy, for the same reasons.
//
// **Device-local only, and it must stay that way.** This is a UI
// convenience, never the enforced truth: a running session reads its
// blocklist from the server row, so editing this default cannot leak into a
// live session (§9's frozen-blocklist rule). Nothing money-equivalent lives
// here.
//
// Failure policy: fail open, to the historical default. A read failure
// pre-fills the same three categories every session enforced before Phase 9
// — the worst case is the host re-picking, never a session that blocks
// something they didn't choose. A write failure still updates the store in
// memory, so the current run behaves correctly.

// Renaming this key would silently orphan every persisted value — pinned by
// test on purpose.
export const BLOCKLIST_PREFERENCE_STORAGE_KEY = '@lockal-time/blocklist-preference';

export interface BlocklistSelection {
  readonly categories: readonly BlockedCategory[];
  readonly packages: readonly string[];
}

export const DEFAULT_BLOCKLIST_SELECTION: BlocklistSelection = {
  categories: DEFAULT_BLOCKED_CATEGORIES,
  packages: [],
};

export type BlocklistPreferenceGate =
  | { readonly status: 'hydrating' }
  | { readonly status: 'ready'; readonly selection: BlocklistSelection };

interface BlocklistPreferenceState {
  preference: BlocklistPreferenceGate;
}

export const useBlocklistPreferenceStore = create<BlocklistPreferenceState>()(() => ({
  preference: { status: 'hydrating' },
}));

// Boundary validation on persisted data: a stored value is as untrusted as
// a bridge payload. An unrecognized category is dropped rather than carried
// forward — this is exactly what happens to anyone who saved a category
// that a later version removed, and silently sending it would be rejected
// by the server's own enum with an error the host cannot act on.
const parseSelection = (raw: string): BlocklistSelection | null => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.categories) || !Array.isArray(value.packages)) {
    return null;
  }
  return {
    categories: value.categories.filter(isBlockedCategory),
    packages: value.packages.filter(
      (packageName): packageName is string =>
        typeof packageName === 'string' && packageName.length > 0,
    ),
  };
};

export const hydrateBlocklistPreference = async (): Promise<void> => {
  let selection = DEFAULT_BLOCKLIST_SELECTION;
  try {
    const raw = await AsyncStorage.getItem(BLOCKLIST_PREFERENCE_STORAGE_KEY);
    if (raw !== null) {
      const parsed = parseSelection(raw);
      // A stored selection that survives validation as empty is not usable
      // — the server rejects a session that blocks nothing — so it falls
      // back to the default rather than pre-filling an unsubmittable form.
      if (parsed !== null && parsed.categories.length + parsed.packages.length > 0) {
        selection = parsed;
      }
    }
  } catch {
    // Fail open — see header comment.
  }
  useBlocklistPreferenceStore.setState({ preference: { status: 'ready', selection } });
};

// Called after a successful create, not on every keystroke: what gets
// remembered is a choice the host actually committed to, not one they were
// midway through changing their mind about.
export const rememberBlocklistPreference = async (
  selection: BlocklistSelection,
): Promise<void> => {
  useBlocklistPreferenceStore.setState({ preference: { status: 'ready', selection } });
  try {
    await AsyncStorage.setItem(
      BLOCKLIST_PREFERENCE_STORAGE_KEY,
      JSON.stringify({ categories: selection.categories, packages: selection.packages }),
    );
  } catch {
    // Fail open — see header comment.
  }
};
