export type NotificationPlatform = 'android' | 'ios';

export interface PushNotificationRequest {
  readonly platform: NotificationPlatform;
  readonly token: string;
  readonly title: string;
  readonly body: string;
}

export interface PushSendResult {
  readonly status: string;
}

// Ports-and-adapters seam (same pattern as attestation-provider.ts /
// apps/mobile's nativeSignIn/blockingPermissions): the dispatch job depends
// on this interface, never a concrete provider, so wiring in real FCM/APNs
// adapters later touches no calling code.
export interface NotificationSender {
  send(request: PushNotificationRequest): Promise<PushSendResult>;
}

// Real FCM (Android) and APNs (iOS) delivery each require credentials that
// don't exist yet — a Firebase project + service account, and an Apple
// Push key/cert respectively (docs/MANUAL_QA.md tracks getting them).
// Writing HTTP-calling adapters against either API's shape now would be
// code nobody can run or confirm against a real credential — worse than no
// adapter, since a subtly wrong guess at the shape would sit untested. This
// placeholder keeps the dispatch *pipeline* (claim logic, targeting,
// retry-free fan-out) real and tested today; only the delivery source is a
// stand-in, same posture as unconfiguredAttestationProvider.
export const unconfiguredNotificationSender: NotificationSender = {
  async send(): Promise<PushSendResult> {
    return { status: 'not_configured' };
  },
};
