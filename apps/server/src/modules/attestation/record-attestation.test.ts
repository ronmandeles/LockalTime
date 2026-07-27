import { recordDeviceAttestation } from './record-attestation';
import type {
  AttestationProvider,
  AttestationRequest,
  AttestationVerdict,
} from './attestation-provider';
import type { AttestationStore, RecordAttestationInput } from './attestation-store';

const INPUT = {
  userId: 'user-abc-123',
  sessionId: '77777777-7777-7777-7777-777777777777',
  platform: 'android' as const,
  action: 'create' as const,
  token: 'opaque-device-token',
};

const buildFakeStore = (): AttestationStore & { recorded: RecordAttestationInput | null } => {
  const store = {
    recorded: null as RecordAttestationInput | null,
    async recordAttestation(input: RecordAttestationInput): Promise<void> {
      store.recorded = input;
    },
  };
  return store;
};

const buildFakeProvider = (
  verify: (request: AttestationRequest) => Promise<AttestationVerdict>,
): AttestationProvider => ({ verify });

describe('recordDeviceAttestation', () => {
  it('persists the provider verdict and raw response verbatim', async () => {
    const store = buildFakeStore();
    const provider = buildFakeProvider(async () => ({
      verdict: 'MEETS_DEVICE_INTEGRITY',
      rawResponse: { some: 'payload' },
    }));

    await recordDeviceAttestation(provider, store, INPUT);

    expect(store.recorded).toEqual({
      userId: INPUT.userId,
      sessionId: INPUT.sessionId,
      platform: INPUT.platform,
      action: INPUT.action,
      verdict: 'MEETS_DEVICE_INTEGRITY',
      rawResponse: { some: 'payload' },
    });
  });

  it('never throws when the provider itself throws — records a provider_error verdict instead', async () => {
    const store = buildFakeStore();
    const provider = buildFakeProvider(async () => {
      throw new Error('provider unreachable');
    });

    await expect(recordDeviceAttestation(provider, store, INPUT)).resolves.toBeUndefined();

    expect(store.recorded?.verdict).toBe('provider_error');
    expect(store.recorded?.rawResponse).toMatchObject({ error: 'provider unreachable' });
  });
});
