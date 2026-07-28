import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

// Phase 4 task 12 — Screen 13 (Welcome Back / Session Interrupted),
// ARCHITECTURE.md §2 item 13. Persists only a session id (device-local UX
// hint — "was I last active here"), never any money-equivalent data
// (CLAUDE.md's Money-Equivalent Logic Rule). Mirrors onboarding-store.ts's
// hydrating/ready discriminated-union pattern so App's cold-start gate can
// never decide whether to show Welcome Back before storage is consulted.
//
// Failure policy (same as onboarding-store.ts, for the same reason): fail
// open. A read failure hydrates as "no last-active session" (skips Welcome
// Back — worst case, a genuinely-interrupted session just isn't offered a
// rejoin prompt); a write failure still updates the store in-memory so the
// current app run behaves correctly regardless.

// Renaming this key would silently orphan every persisted value — pinned by
// test on purpose.
export const ACTIVE_SESSION_STORAGE_KEY = '@lockal-time/last-active-session-id';

export type ActiveSessionGate =
  | { readonly status: 'hydrating' }
  | { readonly status: 'ready'; readonly lastActiveSessionId: string | null };

// Set once WelcomeBackScreen has resolved what to do (rejoin the still-open
// session via Session Details, or go straight to the Completion receipt for
// one that ended while this device was away) — App.tsx reads it exactly
// once, to pick the one NavigationContainer mount's initial route/params.
// Deliberately NOT persisted: it only bridges one gate decision into one
// navigator mount, and must reset every cold start rather than survive one.
export type PendingWelcomeBackNavigation =
  | { readonly screen: 'SessionDetails'; readonly sessionId: string }
  | { readonly screen: 'SessionCompletion'; readonly sessionId: string }
  | null;

interface ActiveSessionState {
  activeSession: ActiveSessionGate;
  pendingWelcomeBackNavigation: PendingWelcomeBackNavigation;
}

export const useActiveSessionStore = create<ActiveSessionState>()(() => ({
  activeSession: { status: 'hydrating' },
  pendingWelcomeBackNavigation: null,
}));

// Reads the persisted last-active session id into the store; the App
// bootstrap calls this once per mount, alongside the onboarding/permission
// hydrations it already runs.
export const hydrateActiveSessionStatus = async (): Promise<void> => {
  let lastActiveSessionId: string | null = null;
  try {
    lastActiveSessionId = await AsyncStorage.getItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    // Fail open — see header comment.
  }
  useActiveSessionStore.setState({ activeSession: { status: 'ready', lastActiveSessionId } });
};

// Called on ActiveSessionScreen mount — from that point on, an interrupted
// relaunch (killed app, dropped connection past the offline cutoff, etc.)
// has something to offer a rejoin for.
export const setActiveSession = async (sessionId: string): Promise<void> => {
  useActiveSessionStore.setState({ activeSession: { status: 'ready', lastActiveSessionId: sessionId } });
  try {
    await AsyncStorage.setItem(ACTIVE_SESSION_STORAGE_KEY, sessionId);
  } catch {
    // Fail open — see header comment.
  }
};

// Called on SessionCompletionScreen mount — the session has a real, final
// receipt now, so it's no longer "interrupted" and must never trigger
// Welcome Back again on a future cold start.
export const clearActiveSession = async (): Promise<void> => {
  useActiveSessionStore.setState({ activeSession: { status: 'ready', lastActiveSessionId: null } });
  try {
    await AsyncStorage.removeItem(ACTIVE_SESSION_STORAGE_KEY);
  } catch {
    // Fail open — see header comment.
  }
};

export const resolveWelcomeBack = (navigation: PendingWelcomeBackNavigation): void => {
  useActiveSessionStore.setState({ pendingWelcomeBackNavigation: navigation });
};
