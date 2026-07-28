export type NotificationLocale = 'en' | 'he';

export interface StreakRiskCopy {
  readonly title: string;
  readonly body: string;
}

// The server's first-ever localized user-facing text (CLAUDE.md's i18n
// rule — English + Hebrew from day one — applies here exactly as it does
// to a mobile screen). A small fixed lookup rather than a full server-side
// i18n library: one string pair, not a growing set of screens. Body copy
// is deliberately generic (no interpolated hour count) — the dispatch job
// (streak-risk-notifier.ts) fires once a threshold is crossed, not on a
// live countdown guaranteed accurate to the minute.
const STREAK_RISK_COPY: Record<NotificationLocale, StreakRiskCopy> = {
  en: {
    title: 'Your streak is at risk',
    body: 'Start a session today to keep it going.',
  },
  he: {
    title: 'הרצף שלך בסכנה',
    body: 'התחילו מפגש כדי לשמור על הרצף.',
  },
};

// Fails open to 'en' for anything unrecognized or missing (users.locale is
// nullable until a client ever reports one) — same fail-open posture as
// the rest of this pipeline (unconfiguredNotificationSender, trust-tier.ts).
export const resolveNotificationLocale = (locale: string | null): NotificationLocale =>
  locale === 'he' ? 'he' : 'en';

export const getStreakRiskCopy = (locale: string | null): StreakRiskCopy =>
  STREAK_RISK_COPY[resolveNotificationLocale(locale)];
