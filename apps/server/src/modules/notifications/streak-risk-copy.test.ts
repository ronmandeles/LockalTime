import { getStreakRiskCopy, resolveNotificationLocale } from './streak-risk-copy';

describe('resolveNotificationLocale', () => {
  const cases: ReadonlyArray<[string | null, 'en' | 'he']> = [
    ['en', 'en'],
    ['he', 'he'],
    [null, 'en'],
    ['fr', 'en'],
    ['', 'en'],
  ];

  it.each(cases)('resolves %p to %p', (input, expected) => {
    expect(resolveNotificationLocale(input)).toBe(expected);
  });
});

describe('getStreakRiskCopy', () => {
  it('returns non-empty, distinct title/body for en and he', () => {
    const en = getStreakRiskCopy('en');
    const he = getStreakRiskCopy('he');

    expect(en.title.length).toBeGreaterThan(0);
    expect(en.body.length).toBeGreaterThan(0);
    expect(he.title.length).toBeGreaterThan(0);
    expect(he.body.length).toBeGreaterThan(0);
    expect(he.title).not.toBe(en.title);
    expect(he.body).not.toBe(en.body);
  });

  it('falls back to english copy for an unrecognized or missing locale', () => {
    expect(getStreakRiskCopy('fr')).toEqual(getStreakRiskCopy('en'));
    expect(getStreakRiskCopy(null)).toEqual(getStreakRiskCopy('en'));
  });

  it('never interpolates a specific hour count — the job dispatches on a threshold crossing, not a live countdown', () => {
    expect(getStreakRiskCopy('en').body).not.toMatch(/\d/);
    expect(getStreakRiskCopy('he').body).not.toMatch(/\d/);
  });
});
