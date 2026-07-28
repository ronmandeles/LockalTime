import { pushRegistration } from './push-registration';

// Phase 5.5 push-registration service contract (mirrors native-sign-in.ts's
// seam exactly). No FCM (@react-native-firebase/messaging or equivalent) or
// APNs native SDK is linked yet, so this is a pure-JS placeholder,
// deterministic by design: fabricating a token would fake a capability the
// app doesn't have. registerPushTokenIfChanged (user-profile.ts) codes
// against this surface only — the future task that links a real SDK swaps
// this module's internals without touching that caller.
//
// Pinned surface:
// - `pushRegistration.getToken()` resolves a discriminated
//   PushRegistrationResult:
//     { status: 'granted'; token: string; platform: 'android' | 'ios' } —
//       a real SDK returned a token (never produced by this placeholder),
//     { status: 'unavailable' } — no SDK exists to obtain one from.
// - Never rejects: a registration attempt is an answer, not an error.
//
// Determinism: no native modules, no timers, no network — pure JS.

describe('pushRegistration.getToken', () => {
  it("resolves 'unavailable' — the placeholder has no push SDK to invoke", async () => {
    await expect(pushRegistration.getToken()).resolves.toEqual({ status: 'unavailable' });
  });

  it('returns the same result on every call — statelessness is placeholder-specific', async () => {
    await expect(pushRegistration.getToken()).resolves.toEqual({ status: 'unavailable' });
    await expect(pushRegistration.getToken()).resolves.toEqual({ status: 'unavailable' });
  });
});
