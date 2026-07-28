import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockFetchSessionHistory = jest.fn();
jest.mock('../services/stats-repository', () => ({
  fetchSessionHistory: (...args: unknown[]) => mockFetchSessionHistory(...args),
  HISTORY_PAGE_SIZE: 20,
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
jest.mock('react-native-localize', () => ({ getLocales: () => mockGetLocales() }), {
  virtual: true,
});

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import HistoryScreen from './HistoryScreen';

// History (Screen 11), DESIGN_GUIDELINES §0: an acquisition surface.
// Solo/Group/All is local screen state, re-querying fetchSessionHistory
// from page one on every filter change — its own contract is pinned in
// stats-repository.test.ts, mocked here.

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
  typeof HistoryScreen
>[0]['navigation'];
const routeStub = { key: 'History', name: 'History' as const, params: undefined };

const renderScreen = async (locale: 'en' | 'he' = 'en'): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);
  await render(
    <I18nProvider i18n={i18n}>
      <HistoryScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

const row = (overrides: Record<string, unknown> = {}) => ({
  id: 'session-1',
  type: 'solo',
  started_at: '2026-08-01T10:00:00.000Z',
  ended_at: '2026-08-01T10:45:00.000Z',
  exit_reason: 'completed',
  total_minutes_present: 45,
  points_earned: 45,
  group_bonus_earned: false,
  completion_bonus_earned: false,
  ...overrides,
});

describe('HistoryScreen', () => {
  beforeEach(() => {
    mockGetLocales.mockReset().mockReturnValue([EN_US]);
    mockUseAuthStore.mockReset().mockImplementation((selector) => selector(AUTHENTICATED_STATE));
    mockFetchSessionHistory.mockReset().mockResolvedValue({ ok: true, value: [] });
  });

  it('renders its title from the en bundle', async () => {
    await renderScreen('en');

    await waitFor(() => expect(screen.getByText(en.history.title)).toBeOnTheScreen());
  });

  it('renders the Hebrew title when the locale is he, proving text flows through i18n', async () => {
    expect(he.history.title).not.toBe(en.history.title);

    await renderScreen('he');

    await waitFor(() => expect(screen.getByText(he.history.title)).toBeOnTheScreen());
  });

  it('shows a loading indicator before the first fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    mockFetchSessionHistory.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    await renderScreen();

    expect(screen.getByTestId('history-loading')).toBeOnTheScreen();

    resolveFetch({ ok: true, value: [] });
    await waitFor(() => expect(screen.getByTestId('history-empty')).toBeOnTheScreen());
  });

  it('fetches with the "all" filter by default', async () => {
    await renderScreen();

    await waitFor(() =>
      expect(mockFetchSessionHistory).toHaveBeenCalledWith(AUTHENTICATED_USER_ID, 'all'),
    );
  });

  it('re-fetches with "solo" when the Solo filter is pressed', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('history-empty')).toBeOnTheScreen());
    mockFetchSessionHistory.mockClear();

    fireEvent.press(screen.getByTestId('history-filter-solo'));

    await waitFor(() =>
      expect(mockFetchSessionHistory).toHaveBeenCalledWith(AUTHENTICATED_USER_ID, 'solo'),
    );
  });

  it('re-fetches with "group" when the Group filter is pressed', async () => {
    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('history-empty')).toBeOnTheScreen());
    mockFetchSessionHistory.mockClear();

    fireEvent.press(screen.getByTestId('history-filter-group'));

    await waitFor(() =>
      expect(mockFetchSessionHistory).toHaveBeenCalledWith(AUTHENTICATED_USER_ID, 'group'),
    );
  });

  it('shows a distinct empty state per filter', async () => {
    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.history.empty.all)).toBeOnTheScreen());

    mockFetchSessionHistory.mockResolvedValue({ ok: true, value: [] });
    fireEvent.press(screen.getByTestId('history-filter-solo'));

    await waitFor(() => expect(screen.getByText(en.history.empty.solo)).toBeOnTheScreen());
  });

  it('renders session rows with date, type, minutes, and points', async () => {
    mockFetchSessionHistory.mockResolvedValue({ ok: true, value: [row()] });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.history.type.solo)).toBeOnTheScreen());
    expect(screen.getByText('45 min')).toBeOnTheScreen();
    expect(screen.getByText('+45')).toBeOnTheScreen();
  });

  it('shows only the earned bonus chips, never an unearned one', async () => {
    mockFetchSessionHistory.mockResolvedValue({
      ok: true,
      value: [row({ group_bonus_earned: true, completion_bonus_earned: false })],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.history.groupBonusChip)).toBeOnTheScreen());
    expect(screen.queryByText(en.history.completionBonusChip)).toBeNull();
  });

  it('shows an error state with a retry affordance when the fetch fails', async () => {
    mockFetchSessionHistory.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.history.loadError)).toBeOnTheScreen());
    expect(screen.getByTestId('history-retry')).toBeOnTheScreen();
  });

  it('retries the fetch when the retry button is pressed', async () => {
    mockFetchSessionHistory.mockResolvedValueOnce({ ok: false, error: { message: 'network error' } });

    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('history-retry')).toBeOnTheScreen());

    mockFetchSessionHistory.mockResolvedValueOnce({ ok: true, value: [row()] });
    fireEvent.press(screen.getByTestId('history-retry'));

    await waitFor(() => expect(screen.getByText(en.history.type.solo)).toBeOnTheScreen());
  });

  it('requests the next page with a cursor of the last row’s ended_at on scroll-to-end', async () => {
    const fullPage = Array.from({ length: 20 }, (_unused, index) =>
      row({ id: `session-${index}`, ended_at: `2026-08-01T10:${String(index).padStart(2, '0')}:00.000Z` }),
    );
    mockFetchSessionHistory.mockResolvedValueOnce({ ok: true, value: fullPage });

    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('history-list')).toBeOnTheScreen());

    mockFetchSessionHistory.mockResolvedValueOnce({ ok: true, value: [] });
    fireEvent(screen.getByTestId('history-list'), 'endReached');

    await waitFor(() =>
      expect(mockFetchSessionHistory).toHaveBeenCalledWith(
        AUTHENTICATED_USER_ID,
        'all',
        '2026-08-01T10:19:00.000Z',
      ),
    );
  });

  it('does not page further once a short page proves there is nothing more', async () => {
    mockFetchSessionHistory.mockResolvedValueOnce({ ok: true, value: [row()] });

    await renderScreen();
    await waitFor(() => expect(screen.getByTestId('history-list')).toBeOnTheScreen());

    mockFetchSessionHistory.mockClear();
    fireEvent(screen.getByTestId('history-list'), 'endReached');

    expect(mockFetchSessionHistory).not.toHaveBeenCalled();
  });

  it('fetches nothing and shows the empty state when unauthenticated', async () => {
    mockUseAuthStore.mockImplementation((selector) => selector(UNAUTHENTICATED_STATE));

    await renderScreen();

    expect(mockFetchSessionHistory).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('history-empty')).toBeOnTheScreen());
  });
});
