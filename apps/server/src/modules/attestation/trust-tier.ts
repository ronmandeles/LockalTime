// Phase 6 tasks 8-9: the device-trust vocabulary this whole hardening pass
// hangs off. Merges backlog's two separate lines — "root/jailbreak
// detection" and "Play Integrity/App Attest enforcement" — into ONE
// mechanism (a deliberate merge, not a silent drop): a rooted/jailbroken
// device is exactly what Play Integrity's/App Attest's own device
// verdict is meant to catch, and a client-side root check can be lied to
// by the very device it's probing. No separate native probe is added.
//
// Pure, no I/O — table-driven, easy to extend once real credentials and
// real verdict strings exist (attestation-provider.ts's
// unconfiguredAttestationProvider is still the only provider wired in;
// every verdict recorded today reads 'not_configured').

export type TrustTier = 'trusted' | 'unverified';

// Deliberately a narrow denylist, not an allowlist: with no real
// credentials, the actual vocabulary Play Integrity/App Attest will
// return is still unknown. Only a small set of KNOWN "no integrity
// signal at all" markers map to 'unverified' — anything unrecognized
// (including 'not_configured' and 'provider_error', record-attestation.ts's
// own fail-open verdicts) fails open to 'trusted', matching this
// pipeline's posture everywhere else (ARCHITECTURE.md §8 item 8).
const KNOWN_UNTRUSTED_VERDICTS: ReadonlySet<string> = new Set(['NONE', 'UNRECOGNIZED_VERDICT']);

export const verdictToTrustTier = (verdict: string): TrustTier =>
  KNOWN_UNTRUSTED_VERDICTS.has(verdict) ? 'unverified' : 'trusted';

// The one place ATTESTATION_ENFORCEMENT_ENABLED actually takes effect —
// every other consumer (points/group-bonus.ts, apply_session_stats())
// just reads whatever tier was already written, so gating here once at
// write time is what makes the whole feature inert while the flag is
// false (the shipping default) without threading the flag through every
// downstream reader.
export const applyEnforcementPolicy = (tier: TrustTier, enforcementEnabled: boolean): TrustTier => {
  if (!enforcementEnabled) {
    return 'trusted';
  }
  return tier;
};
