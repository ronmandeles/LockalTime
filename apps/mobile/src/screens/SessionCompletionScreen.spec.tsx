import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockFetchSessionParticipant = jest.fn();
const mockFetchRewardsHistory = jest.fn();
jest.mock('../services/session-repository', () => ({
  fetchSessionParticipant: (...args: unknown[]) => mockFetchSessionParticipant(...args),
  fetchRewardsHistory: (...args: unknown[]) => mockFetchRewardsHistory(...args),
}));

// Mocked directly (not the real store + setState) — same seam pattern as
// useSession/useAppBlocker elsewhere in this codebase, and sidesteps a real
// timing hazard: the real store's state changing while an in-flight fetch
// effect from a just-finished test is still settling races the next test's
// own render.
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
const EN_US: DeviceLocaleStub = { countryCode: 'US', isRTL: false, languageCode: 'en', languageTag: 'en-US' };
const mockGetLocales = jest.fn<DeviceLocaleStub[], []>(() => [EN_US]);
jest.mock('react-native-localize', () => ({ getLocales: () => mockGetLocales() }), { virtual: true });

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import SessionCompletionScreen from './SessionCompletionScreen';

// Session Completion (Screen 10), DESIGN_GUIDELINES §0: an ACQUISITION
// surface (full design effort) reached either from a normal session end or
// a successful Emergency Exit — session_participants.exit_reason (already
// computed server-side, never re-derived here per the Money-Equivalent
// Logic Rule) is what tells the two apart. fetchSessionParticipant/
// fetchRewardsHistory are mocked; their own contracts are pinned in
// session-repository.test.ts.

const navigationStub = {
  reset: jest.fn(),
} as unknown as Parameters<typeof SessionCompletionScreen>[0]['navigation'];
const routeStub = {
  key: 'SessionCompletion',
  name: 'SessionCompletion' as const,
  params: { sessionId: 'session-1' },
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <SessionCompletionScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

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

describe('SessionCompletionScreen', () => {
  beforeEach(() => {
    mockFetchSessionParticipant.mockReset();
    mockFetchRewardsHistory.mockReset().mockResolvedValue({ ok: true, value: [] });
    (navigationStub.reset as jest.Mock).mockReset();
    mockUseAuthStore.mockReset().mockImplementation((selector) => selector(AUTHENTICATED_STATE));
  });

  it('shows a loading state before the fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    mockFetchSessionParticipant.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    await renderScreen();

    expect(screen.getByTestId('session-completion-loading')).toBeOnTheScreen();

    resolveFetch({ ok: true, value: null });
    await waitFor(() => expect(screen.getByText(en.sessionCompletion.notReady)).toBeOnTheScreen());
  });

  it('shows the completed title and full breakdown when the participant completed the session', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 90,
        exit_reason: 'completed',
        group_bonus_earned: true,
        completion_bonus_earned: true,
        points_earned: 108,
      },
    });
    mockFetchRewardsHistory.mockResolvedValue({
      ok: true,
      value: [
        { points: 90, bonus_type: 'base' },
        { points: 9, bonus_type: 'group_bonus' },
        { points: 9, bonus_type: 'completion_bonus' },
      ],
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('session-completion-points')).toBeOnTheScreen());
    expect(screen.getByText(en.sessionCompletion.title.completed)).toBeOnTheScreen();
    expect(screen.getByTestId('session-completion-points')).toHaveTextContent('108');
    expect(screen.getByText(en.sessionCompletion.breakdown.base)).toBeOnTheScreen();
    expect(screen.getByText(en.sessionCompletion.breakdown.groupBonus)).toBeOnTheScreen();
    expect(screen.getByText(en.sessionCompletion.breakdown.completionBonus)).toBeOnTheScreen();
    expect(screen.queryByText(en.sessionCompletion.forfeitedNote)).toBeNull();
  });

  it('shows only the earned bonus rows, not ones that were never granted', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 45,
        exit_reason: 'completed',
        group_bonus_earned: false,
        completion_bonus_earned: false,
        points_earned: 45,
      },
    });
    mockFetchRewardsHistory.mockResolvedValue({ ok: true, value: [{ points: 45, bonus_type: 'base' }] });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('session-completion-points')).toBeOnTheScreen());
    expect(screen.getByText(en.sessionCompletion.breakdown.base)).toBeOnTheScreen();
    expect(screen.queryByText(en.sessionCompletion.breakdown.groupBonus)).toBeNull();
    expect(screen.queryByText(en.sessionCompletion.breakdown.completionBonus)).toBeNull();
  });

  it('shows the "left early" title and forfeited note for an emergency exit', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 23,
        exit_reason: 'emergency_exit',
        group_bonus_earned: false,
        completion_bonus_earned: false,
        points_earned: 23,
      },
    });
    mockFetchRewardsHistory.mockResolvedValue({ ok: true, value: [{ points: 23, bonus_type: 'base' }] });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('session-completion-points')).toBeOnTheScreen());
    expect(screen.getByText(en.sessionCompletion.title.left)).toBeOnTheScreen();
    expect(screen.getByText(en.sessionCompletion.forfeitedNote)).toBeOnTheScreen();
  });

  it('shows the "left early" title for a disconnected participant too', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 10,
        exit_reason: 'disconnected',
        group_bonus_earned: false,
        completion_bonus_earned: false,
        points_earned: 10,
      },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.sessionCompletion.title.left)).toBeOnTheScreen());
  });

  it('shows the minutes-present count', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 45,
        exit_reason: 'completed',
        group_bonus_earned: false,
        completion_bonus_earned: false,
        points_earned: 45,
      },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByText('45 minutes present')).toBeOnTheScreen());
  });

  it('shows a not-ready state when finalization has not landed yet (null participant)', async () => {
    mockFetchSessionParticipant.mockResolvedValue({ ok: true, value: null });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.sessionCompletion.notReady)).toBeOnTheScreen());
  });

  it('shows a not-ready state when the fetch fails', async () => {
    mockFetchSessionParticipant.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    await waitFor(() => expect(screen.getByText(en.sessionCompletion.notReady)).toBeOnTheScreen());
  });

  it('resets navigation to Home when Done is pressed', async () => {
    mockFetchSessionParticipant.mockResolvedValue({
      ok: true,
      value: {
        session_id: 'session-1',
        user_id: AUTHENTICATED_USER_ID,
        is_host: false,
        total_minutes_present: 10,
        exit_reason: 'completed',
        group_bonus_earned: false,
        completion_bonus_earned: false,
        points_earned: 10,
      },
    });

    await renderScreen();

    await waitFor(() => expect(screen.getByTestId('session-completion-done')).toBeOnTheScreen());
    fireEvent.press(screen.getByTestId('session-completion-done'));

    expect(navigationStub.reset).toHaveBeenCalledWith({ index: 0, routes: [{ name: 'Home' }] });
  });

  it('fetches using the authenticated user id and the route sessionId', async () => {
    mockFetchSessionParticipant.mockResolvedValue({ ok: true, value: null });

    await renderScreen();

    await waitFor(() =>
      expect(mockFetchSessionParticipant).toHaveBeenCalledWith('session-1', AUTHENTICATED_USER_ID),
    );
  });
});
