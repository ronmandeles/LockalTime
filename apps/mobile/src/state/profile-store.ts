import { create } from 'zustand';

import { fetchUserProfile } from '../services/user-profile';
import type { UserRole } from '../services/user-profile';

// Phase 6: the client's one notion of "am I a privileged user" — gates
// venue management and the static_qr option in Create Session. Unlike
// onboarding/permission-store.ts, this is never persisted to AsyncStorage:
// there's no cold-start flash to avoid (role only gates a subdued link/an
// extra form option, never a first screen), and re-fetching fresh on every
// authenticated session avoids ever showing a stale role after a manual
// runbook flip (docs/RUNBOOK_VERIFIED_HOST.md).
interface ProfileState {
  role: UserRole | null;
  setRole: (role: UserRole | null) => void;
}

export const useProfileStore = create<ProfileState>()((set) => ({
  role: null,
  setRole: (role: UserRole | null): void => {
    set({ role });
  },
}));

// Fire-and-forget (App.tsx, alongside reportTimezoneIfChanged) — fail-open:
// a failed fetch just leaves role at null (no privileged UI shown), never
// blocks the app. Never throws, so callers need no .catch().
export const hydrateProfile = async (userId: string): Promise<void> => {
  try {
    const result = await fetchUserProfile(userId);
    if (result.ok && result.value !== null) {
      useProfileStore.getState().setRole(result.value.role);
    }
  } catch {
    // Fail open — same posture as reportTimezoneIfChanged.
  }
};

// Called on sign-out (App.tsx) so a subsequent sign-in by a DIFFERENT user
// never briefly shows the previous user's role before hydrateProfile()
// re-resolves it.
export const resetProfile = (): void => {
  useProfileStore.getState().setRole(null);
};
