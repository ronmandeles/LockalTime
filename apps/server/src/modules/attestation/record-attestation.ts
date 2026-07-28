import type {
  AttestationAction,
  AttestationPlatform,
  AttestationProvider,
} from './attestation-provider';
import type { AttestationStore } from './attestation-store';

export interface RecordDeviceAttestationInput {
  readonly userId: string;
  readonly sessionId: string | null;
  readonly platform: AttestationPlatform;
  readonly action: AttestationAction;
  readonly token: string;
}

// Monitor-mode only (ARCHITECTURE.md §8 item 8): never blocks create/join,
// only logs. Two independent fail-open layers — a thrown provider error is
// caught here and recorded as its own verdict; a failed DB write is
// swallowed inside the store — so this function itself never rejects.
//
// Returns the verdict string (Phase 6 tasks 8-9) so callers can feed it
// into attestation/trust-tier.ts's verdictToTrustTier() — existing callers
// that only awaited this as a bare statement are unaffected.
export const recordDeviceAttestation = async (
  provider: AttestationProvider,
  store: AttestationStore,
  input: RecordDeviceAttestationInput,
): Promise<string> => {
  let verdict: string;
  let rawResponse: unknown;

  try {
    const result = await provider.verify({
      platform: input.platform,
      action: input.action,
      token: input.token,
    });
    verdict = result.verdict;
    rawResponse = result.rawResponse;
  } catch (thrown) {
    verdict = 'provider_error';
    rawResponse = { error: thrown instanceof Error ? thrown.message : String(thrown) };
  }

  await store.recordAttestation({
    userId: input.userId,
    sessionId: input.sessionId,
    platform: input.platform,
    action: input.action,
    verdict,
    rawResponse,
  });

  return verdict;
};
