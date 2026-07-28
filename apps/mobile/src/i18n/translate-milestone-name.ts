// A milestone's slug is DB-sourced reference data (docs/DATABASE.md:
// "slug is the i18n key"), not a value TypeScript can verify against the
// locale schema at compile time. Rather than an unchecked cast to force a
// dynamically-built key through the typed t() (typescript-strictness
// skill: no unchecked assertions on boundary data), this is an exhaustive
// switch over the known literal keys, with a defensive fallback to the raw
// slug for a milestone seeded server-side without a matching translation
// yet — never a crash, just slightly-rough copy for one edge case.
// Shared by HomeScreen (progress bar) and StatsScreen (achieved list) —
// the one place this switch is written.
export const translateMilestoneName = (t: (key: string) => string, slug: string): string => {
  switch (slug) {
    case 'sessions_5':
      return t('milestones.sessions_5');
    case 'sessions_10':
      return t('milestones.sessions_10');
    case 'sessions_25':
      return t('milestones.sessions_25');
    case 'sessions_50':
      return t('milestones.sessions_50');
    case 'sessions_100':
      return t('milestones.sessions_100');
    case 'sessions_250':
      return t('milestones.sessions_250');
    default:
      return slug;
  }
};
