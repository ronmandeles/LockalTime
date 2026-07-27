import type { SupabaseClient } from '@supabase/supabase-js';

import type { AttestationAction, AttestationPlatform } from './attestation-provider';

export interface RecordAttestationInput {
  readonly userId: string;
  readonly sessionId: string | null;
  readonly platform: AttestationPlatform;
  readonly action: AttestationAction;
  readonly verdict: string;
  readonly rawResponse: unknown;
}

export interface AttestationStore {
  recordAttestation(input: RecordAttestationInput): Promise<void>;
}

export const createSupabaseAttestationStore = (client: SupabaseClient): AttestationStore => ({
  async recordAttestation(input) {
    const { error } = await client.from('device_attestations').insert({
      user_id: input.userId,
      session_id: input.sessionId,
      platform: input.platform,
      action: input.action,
      verdict: input.verdict,
      raw_response: input.rawResponse,
    });

    if (error !== null) {
      // Fail-open, same as the provider call in record-attestation.ts:
      // losing one monitor-mode log row must never break create/join.
      // eslint-disable-next-line no-console -- only server-side log path.
      console.error('Failed to record device attestation', error);
    }
  },
});
