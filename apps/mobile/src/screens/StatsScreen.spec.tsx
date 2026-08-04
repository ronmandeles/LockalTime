import React from 'react';

import { render, screen, waitFor } from '@testing-library/react-native';

const mockFetchUserStats = jest.fn();
const mockFetchUserStreak = jest.fn();
const mockFetchDailyStats = jest.fn();
const mockFetchMilestoneProgress = jest.fn();
jest.mock('../services/stats-repository', () => ({
  fetchDailyStats: (...args: unknown[]) => mockFetchDailyStats(...args),
  fetchMilestoneProgress: (...args: unknown[]) => mockFetchMilestoneProgress(...args),
  fetchUserStats: (...args: unknown[]) => mockFetchUserStats(...args),
  fetchUserStreak: (...args: unknown[]) => mockFetchUserStreak(...args),
}));

// Deterministic "today" for every test — otherwise the 7-day window (and
// which weekday label lands where) would depend on when the suite happens
// to run (testing-standards skill: no wall-clock dependence in tests).
jest.mock('../services/local-days', () => ({
  getLastSevenLocalDays: () => [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
    '2026-08-12',
    '2026-08-13',
    '2026-08-14',
    '2026-08-15',
  ],
}));

const mockUseAuthStore = jest.fn();
jest.mock('../state/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => mockUseAuthStore(selector),
}));

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}

const EN_US: DeviceLocaleStub = {
  countryCode: 'US',
  isRTL: false,
  languageCode: 'en',
  languageTag: 'en-US',
};

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>(() => [EN_US]);
jest.mock('react-native-localize', () => ({ getLocales: () => mockGetLocales() }));

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import StatsScreen from './StatsScreen';

// Stats (Screen 12), DESIGN_GUIDELINES §0: an acquisition surface. Lifetime
// aggregates/streak/7-day chart/achieved milestones — the repository
// functions' own contracts are pinned in stats-repository.test.ts, mocked
// here.

const AUTHENTICATED_USER_ID = 'user-1';
const AUTHENTICATED_STATE = {
  auth: {
    status: 'authenticated' as const,
    session: {
      accessToken: 'token',
      refreshToken: 'refresh',
      user: { id: AUTHENTICATED_USER_ID, email: 'a@b.com' },
    },
  },
};
const UNAUTHENTICATED_STATE = { auth: { status: 'unauthenticated' as const } };

const navigationStub = { navigate: jest.fn() } as unknown as Parameters<
  typeof StatsScreen
>[0]['navigation'];
const routeStub = { key: 'Stats', name: 'Stats' as const, params: undefined };

const renderScreen = async (locale: 'en' | 'he' = 'en'): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);
  await render(
    <I18nProvider i18n={i18n}>
      <StatsScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('StatsScreen', () => {
  beforeEach(() => {
    mockGetLocales.mockReset().mockReturnValue([EN_US]);
    mockUseAuthStore.mockReset().mockImplementation((selector) => selector(AUTHENTICATED_STATE));
    mockFetchUserStats.mockReset().mockResolvedValue({ ok: true, value: null });
    mockFetchUserStreak.mockReset().mockResolvedValue({ ok: true, value: null });
    mockFetchDailyStats.mockReset().mockResolvedValue({ ok: true, value: [] });
    mockFetchMilestoneProgress.mockReset().mockResolvedValue({
      ok: true,
      value: { milestones: [], achievedMilestoneIds: new Set() },
    });
  });

  it('renders its title from the en bundle', async () => {
    await renderScreen('en');

    expect(screen.getByText(en.stats.title)).toBeOnTheScreen();
  });

  it('renders the Hebrew title when the locale is he, proving text flows through i18n', async () => {
    expect(he.stats.title).not.toBe(en.stats.title);

    await renderScreen('he');

    expect(screen.getByText(he.stats.title)).toBeOnTheScreen();
  });

  it('shows real zeros immediately, before the fetch resolves', async () => {
    let resolveStats: (value: unknown) => void = () => undefined;
    mockFetchUserStats.mockReturnValue(new Promise((resolve) => (resolveStats = resolve)));

    await renderScreen();

    expect(screen.getByTestId('stats-total-points')).toHaveTextContent('0');

    resolveStats({ ok: true, value: { total_points: 250, total_minutes: 300 } });
    await waitFor(() => expect(screen.getByTestId('stats-total-points')).toHaveTextContent('250'));
  });

  it('shows lifetime totals once fetched', async () => {
    mockFetchUserStats.mockResolvedValue({
      ok: true,
      value: {
        total_minutes: 300,
        total_points: 250,
        sessions_completed: 5,
        sessions_emergency_exit: 1,
        sessions_disconnected: 0,
      },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('stats-total-points')).toHaveTextContent('250'));
    expect(screen.getByTestId('stats-total-minutes')).toHaveTextContent('300');
  });

  it('shows current and longest streak', async () => {
    mockFetchUserStreak.mockResolvedValue({
      ok: true,
      value: { current_streak: 4, longest_streak: 12, streak_grace_expires_at: null },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('stats-current-streak')).toHaveTextContent('4'));
    expect(screen.getByTestId('stats-longest-streak')).toHaveTextContent('12');
  });

  it('renders one chart bar per day of the fixed 7-day window', async () => {
    mockFetchDailyStats.mockResolvedValue({
      ok: true,
      value: [
        { day: '2026-08-14', minutes: 30, points: 30, sessions: 1 },
        { day: '2026-08-15', minutes: 60, points: 60, sessions: 1 },
      ],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('stats-bar-2026-08-15')).toBeOnTheScreen());
    for (const day of [
      '2026-08-09',
      '2026-08-10',
      '2026-08-11',
      '2026-08-12',
      '2026-08-13',
      '2026-08-14',
      '2026-08-15',
    ]) {
      expect(screen.getByTestId(`stats-bar-${day}`)).toBeOnTheScreen();
    }
  });

  it('fetches the daily series starting from the 7-day window’s first day', async () => {
    await renderScreen();

    await waitFor(() =>
      expect(mockFetchDailyStats).toHaveBeenCalledWith(AUTHENTICATED_USER_ID, '2026-08-09'),
    );
  });

  it('shows the no-milestones-yet message when nothing has been achieved', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('stats-milestones-empty')).toBeOnTheScreen());
  });

  it('lists achieved milestones by name, not id', async () => {
    mockFetchMilestoneProgress.mockResolvedValue({
      ok: true,
      value: {
        milestones: [
          { id: 'm1', slug: 'sessions_5', sessions_required: 5, bonus_points: 50 },
          { id: 'm2', slug: 'sessions_10', sessions_required: 10, bonus_points: 100 },
        ],
        achievedMilestoneIds: new Set(['m1']),
      },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.milestones.sessions_5)).toBeOnTheScreen());
    expect(screen.queryByText(en.milestones.sessions_10)).toBeNull();
  });

  it('fetches nothing and shows zeros when unauthenticated', async () => {
    mockUseAuthStore.mockImplementation((selector) => selector(UNAUTHENTICATED_STATE));

    await renderScreen();

    expect(mockFetchUserStats).not.toHaveBeenCalled();
    expect(screen.getByTestId('stats-total-points')).toHaveTextContent('0');
  });

  it('shows zeros, not an error, when a read fails', async () => {
    mockFetchUserStats.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('stats-total-points')).toHaveTextContent('0'));
  });
});
