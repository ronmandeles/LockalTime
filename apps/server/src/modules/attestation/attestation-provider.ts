export type AttestationPlatform = 'android' | 'ios';
export type AttestationAction = 'create' | 'join';

export interface AttestationRequest {
  readonly platform: AttestationPlatform;
  readonly action: AttestationAction;
  readonly token: string;
}

export interface AttestationVerdict {
  readonly verdict: string;
  readonly rawResponse: unknown;
}

// Ports-and-adapters seam (same pattern as apps/mobile's nativeSignIn /
// blockingPermissions): the create/join routes depend on this interface,
// never on a concrete provider, so swapping in the real thing later
// touches no calling code.
export interface AttestationProvider {
  verify(request: AttestationRequest): Promise<AttestationVerdict>;
}

// Real Play Integrity (Android) and App Attest (iOS) verification each
// require credentials that don't exist yet — a Google Play Console service
// account tied to this app's package name, and an Apple Developer Team ID
// + DeviceCheck key respectively (docs/MANUAL_QA.md tracks getting them).
// Writing HTTP-calling adapters against either API's request/response
// shape now would be code nobody can run or confirm against a real
// credential — worse than no adapter, since a subtly wrong guess at the
// shape would sit untested until Phase 6. This placeholder returns a fixed
// verdict so the monitor-mode *pipeline* (this module, the DB write, the
// create/join wiring) is real and tested end-to-end today; only the
// verdict source is a stand-in.
export const unconfiguredAttestationProvider: AttestationProvider = {
  async verify(request: AttestationRequest): Promise<AttestationVerdict> {
    return {
      verdict: 'not_configured',
      rawResponse: { platform: request.platform, reason: 'no attestation credentials configured' },
    };
  },
};
