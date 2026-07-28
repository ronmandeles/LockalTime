import { applyEnforcementPolicy, verdictToTrustTier } from './trust-tier';

describe('verdictToTrustTier', () => {
  it.each(['NONE', 'UNRECOGNIZED_VERDICT'])(
    'maps the known no-integrity-signal verdict %s to unverified',
    (verdict) => {
      expect(verdictToTrustTier(verdict)).toBe('unverified');
    },
  );

  it('fails open to trusted for not_configured (the current placeholder provider)', () => {
    expect(verdictToTrustTier('not_configured')).toBe('trusted');
  });

  it('fails open to trusted for provider_error (a thrown provider call)', () => {
    expect(verdictToTrustTier('provider_error')).toBe('trusted');
  });

  it('fails open to trusted for any unrecognized verdict string', () => {
    expect(verdictToTrustTier('MEETS_DEVICE_INTEGRITY')).toBe('trusted');
    expect(verdictToTrustTier('something-nobody-has-seen-yet')).toBe('trusted');
    expect(verdictToTrustTier('')).toBe('trusted');
  });
});

describe('applyEnforcementPolicy', () => {
  it('forces trusted when enforcement is disabled, regardless of the raw tier', () => {
    expect(applyEnforcementPolicy('unverified', false)).toBe('trusted');
    expect(applyEnforcementPolicy('trusted', false)).toBe('trusted');
  });

  it('passes the raw tier through unchanged when enforcement is enabled', () => {
    expect(applyEnforcementPolicy('unverified', true)).toBe('unverified');
    expect(applyEnforcementPolicy('trusted', true)).toBe('trusted');
  });
});
