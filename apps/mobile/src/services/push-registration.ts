export type PushPlatform = 'android' | 'ios';

export type PushRegistrationResult =
  | { readonly status: 'granted'; readonly token: string; readonly platform: PushPlatform }
  | { readonly status: 'unavailable' };

export interface PushRegistrationService {
  readonly getToken: () => Promise<PushRegistrationResult>;
}

// Phase 5.5 placeholder: no FCM (@react-native-firebase/messaging or
// equivalent) or APNs native SDK is linked yet — fabricating a token would
// fake a capability the app doesn't have, same reasoning as
// native-sign-in.ts. Deterministically reports 'unavailable' until a real
// SDK is wired (docs/MANUAL_QA.md tracks the credentials/linking work);
// registerPushTokenIfChanged (user-profile.ts) is therefore a no-op in
// practice today — honest, not faked.
export const pushRegistration: PushRegistrationService = {
  getToken: () => Promise.resolve({ status: 'unavailable' }),
};
