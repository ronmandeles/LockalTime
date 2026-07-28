import { translateMilestoneName } from './translate-milestone-name';

describe('translateMilestoneName', () => {
  const t = (key: string): string => `translated(${key})`;

  it.each([
    'sessions_5',
    'sessions_10',
    'sessions_25',
    'sessions_50',
    'sessions_100',
    'sessions_250',
  ])('translates the known slug %s via its milestones.* key', (slug) => {
    expect(translateMilestoneName(t, slug)).toBe(`translated(milestones.${slug})`);
  });

  it('falls back to the raw slug for an unrecognized one, rather than crashing', () => {
    expect(translateMilestoneName(t, 'sessions_1000')).toBe('sessions_1000');
  });
});
