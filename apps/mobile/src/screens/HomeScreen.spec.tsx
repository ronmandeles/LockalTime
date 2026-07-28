import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockFetchUserStats = jest.fn();
const mockFetchUserStreak = jest.fn();
const mockFetchMilestoneProgress = jest.fn();
jest.mock('../services/stats-repository', () => ({
  fetchMilestoneProgress: (...args: unknown[]) => mockFetchMilestoneProgress(...args),
  fetchUserStats: (...args: unknown[]) => mockFetchUserStats(...args),
  fetchUserStreak: (...args: unknown[]) => mockFetchUserStreak(...args),
}));

// Mocked directly, same seam pattern as SessionCompletionScreen.spec.tsx —
// sidesteps a real store's state racing a still-settling fetch effect from
// the previous test.
const mockUseAuthStore = jest.fn();
jest.mock('../state/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => mockUseAuthStore(selector),
}));

// profile-store.ts is used for real (via useProfileStore.setState below) —
// but its hydrateProfile import chain pulls in AsyncStorage/react-native-
// localize's real modules, which this file never otherwise mocks. Stubbed
// here purely so importing profile-store doesn't transitively load them;
// HomeScreen itself only ever reads the store's state, never calls
// hydrateProfile.
jest.mock('../services/user-profile', () => ({ fetchUserProfile: jest.fn() }));

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

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>();

jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => mockGetLocales(),
  }),
  { virtual: true },
);

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import { useProfileStore } from '../state/profile-store';
import HomeScreen from './HomeScreen';

// Phase 1 i18n foundation: the Home placeholder migrates onto the i18n layer.
// Rendering under the he locale and finding the Hebrew string is the
// strongest "no hardcoded UI strings" assertion available at test level — a
// literal in the component cannot change language. Assertions reference the
// locale modules, never re-typed literals, so copy edits don't break specs.
//
// Phase 5 adds a gamification summary card (streak/points/milestone
// progress) above the original two CTAs (ARCHITECTURE.md §9: quiet, no
// prize-dangling framing) — this screen now fetches on mount for the first
// time, but deliberately does not gate the CTAs behind that fetch (see
// HomeScreen.tsx's header comment).

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

const mockNavigate = jest.fn();
const navigationStub = { navigate: mockNavigate } as unknown as Parameters<typeof HomeScreen>[0]['navigation'];
const routeStub = { key: 'Home', name: 'Home' as const, params: undefined };

const renderHomeScreenIn = async (locale: 'en' | 'he'): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);

  // RNTL v14 render is async (returns a Promise) — must be awaited.
  await render(
    <I18nProvider i18n={i18n}>
      <HomeScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('HomeScreen', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
    mockNavigate.mockClear();
    mockUseAuthStore.mockReset().mockImplementation((selector) => selector(AUTHENTICATED_STATE));
    mockFetchUserStats.mockReset().mockResolvedValue({ ok: true, value: null });
    mockFetchUserStreak.mockReset().mockResolvedValue({ ok: true, value: null });
    mockFetchMilestoneProgress.mockReset().mockResolvedValue({
      ok: true,
      value: { milestones: [], achievedMilestoneIds: new Set() },
    });
    useProfileStore.setState({ role: null });
  });

  it('renders its title from the en bundle when the locale is en', async () => {
    await renderHomeScreenIn('en');

    expect(screen.getByText(en.home.title)).toBeOnTheScreen();
  });

  it('renders the Hebrew title when the locale is he, proving text flows through i18n', async () => {
    // Guard: if the two bundles ever carried the same string for this key,
    // the assertions below would pass against a hardcoded literal too.
    expect(he.home.title).not.toBe(en.home.title);

    await renderHomeScreenIn('he');

    expect(screen.getByText(he.home.title)).toBeOnTheScreen();
    expect(screen.queryByText(en.home.title)).toBeNull();
  });

  it('navigates to CreateSession when the create CTA is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-create-session-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('CreateSession');
  });

  it('navigates to ScanSession when the scan CTA is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-scan-qr-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('ScanSession');
  });

  it('navigates to History when the history link is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-history-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('History');
  });

  it('navigates to Stats when the stats link is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-stats-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('Stats');
  });

  it('renders real zeros for a brand-new user before the fetch resolves, never blocking the CTAs', async () => {
    let resolveStats: (value: unknown) => void = () => undefined;
    mockFetchUserStats.mockReturnValue(new Promise((resolve) => (resolveStats = resolve)));

    await renderHomeScreenIn('en');

    expect(screen.getByTestId('home-total-points')).toHaveTextContent('0');
    expect(screen.getByTestId('home-create-session-cta')).toBeOnTheScreen();

    resolveStats({ ok: true, value: { total_points: 90 } });
    await waitFor(() => expect(screen.getByTestId('home-total-points')).toHaveTextContent('90'));
  });

  it('shows total points once fetched', async () => {
    mockFetchUserStats.mockResolvedValue({
      ok: true,
      value: {
        total_minutes: 90,
        total_points: 90,
        sessions_completed: 3,
        sessions_emergency_exit: 0,
        sessions_disconnected: 0,
      },
    });

    await renderHomeScreenIn('en');

    await waitFor(() => expect(screen.getByTestId('home-total-points')).toHaveTextContent('90'));
  });

  it('shows the streak count when the user has an active streak', async () => {
    mockFetchUserStreak.mockResolvedValue({
      ok: true,
      value: { current_streak: 4, longest_streak: 9, streak_grace_expires_at: null },
    });

    await renderHomeScreenIn('en');

    await waitFor(() =>
      expect(screen.getByTestId('home-streak')).toHaveTextContent(
        en.home.summary.streakCount.replace('{{count}}', '4'),
      ),
    );
  });

  it('shows the no-streak-yet copy when current_streak is 0', async () => {
    mockFetchUserStreak.mockResolvedValue({
      ok: true,
      value: { current_streak: 0, longest_streak: 0, streak_grace_expires_at: null },
    });

    await renderHomeScreenIn('en');

    await waitFor(() =>
      expect(screen.getByText(en.home.summary.streakNone)).toBeOnTheScreen(),
    );
  });

  it('shows a milestone progress bar naming the next uncrossed milestone', async () => {
    mockFetchUserStats.mockResolvedValue({
      ok: true,
      value: {
        total_minutes: 20,
        total_points: 20,
        sessions_completed: 2,
        sessions_emergency_exit: 0,
        sessions_disconnected: 0,
      },
    });
    mockFetchMilestoneProgress.mockResolvedValue({
      ok: true,
      value: {
        milestones: [
          { id: 'm1', slug: 'sessions_5', sessions_required: 5, bonus_points: 50 },
          { id: 'm2', slug: 'sessions_10', sessions_required: 10, bonus_points: 100 },
        ],
        achievedMilestoneIds: new Set(),
      },
    });

    await renderHomeScreenIn('en');

    await waitFor(() =>
      expect(screen.getByTestId('home-milestone-progress')).toHaveTextContent(
        `3 more sessions to ${en.milestones.sessions_5}`,
      ),
    );
  });

  it('shows an all-milestones-reached message once every milestone is crossed', async () => {
    mockFetchMilestoneProgress.mockResolvedValue({
      ok: true,
      value: {
        milestones: [{ id: 'm1', slug: 'sessions_5', sessions_required: 5, bonus_points: 50 }],
        achievedMilestoneIds: new Set(['m1']),
      },
    });

    await renderHomeScreenIn('en');

    await waitFor(() =>
      expect(screen.getByText(en.home.summary.allMilestonesReached)).toBeOnTheScreen(),
    );
  });

  it('fetches nothing and shows zeros when unauthenticated', async () => {
    mockUseAuthStore.mockImplementation((selector) => selector(UNAUTHENTICATED_STATE));

    await renderHomeScreenIn('en');

    expect(mockFetchUserStats).not.toHaveBeenCalled();
    expect(screen.getByTestId('home-total-points')).toHaveTextContent('0');
  });

  it('shows zeros, not an error, when the stats fetch fails', async () => {
    mockFetchUserStats.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderHomeScreenIn('en');

    await waitFor(() => expect(screen.getByTestId('home-total-points')).toHaveTextContent('0'));
  });

  it('does not show the manage-venues link for a plain user', async () => {
    await renderHomeScreenIn('en');

    expect(screen.queryByTestId('home-manage-venues-cta')).toBeNull();
  });

  it('shows the manage-venues link for a verified host and navigates to VenueManagement', async () => {
    useProfileStore.setState({ role: 'verified_host' });

    await renderHomeScreenIn('en');
    fireEvent.press(screen.getByTestId('home-manage-venues-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('VenueManagement');
  });

  it('shows the manage-venues link for an admin too', async () => {
    useProfileStore.setState({ role: 'admin' });

    await renderHomeScreenIn('en');

    expect(screen.getByTestId('home-manage-venues-cta')).toBeOnTheScreen();
  });

  it('shows the venue-dashboard link for a verified host and navigates to VenueDashboard', async () => {
    useProfileStore.setState({ role: 'verified_host' });

    await renderHomeScreenIn('en');
    fireEvent.press(screen.getByTestId('home-venue-dashboard-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('VenueDashboard');
  });

  it('does not show the venue-dashboard link for a plain user', async () => {
    await renderHomeScreenIn('en');

    expect(screen.queryByTestId('home-venue-dashboard-cta')).toBeNull();
  });
});
