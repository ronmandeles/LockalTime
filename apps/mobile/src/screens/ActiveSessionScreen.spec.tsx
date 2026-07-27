import React from 'react';

import { act, render, screen, waitFor } from '@testing-library/react-native';

const mockUseSession = jest.fn();
jest.mock('../hooks/use-session', () => ({
  useSession: (...args: unknown[]) => mockUseSession(...args),
}));

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}
const EN_US: DeviceLocaleStub = { countryCode: 'US', isRTL: false, languageCode: 'en', languageTag: 'en-US' };
const mockGetLocales = jest.fn<DeviceLocaleStub[], []>(() => [EN_US]);
jest.mock('react-native-localize', () => ({ getLocales: () => mockGetLocales() }), { virtual: true });

import ActiveSessionScreen from './ActiveSessionScreen';

// Active Session (Screen 6), DESIGN_GUIDELINES §0: an IN-SESSION surface —
// deliberately quiet, no stimulation beyond what's functionally necessary
// (the timer, the participant list). useSession is mocked; its own
// contract is pinned in use-session.test.ts. Per Phase 2 task 2.7's plan:
// the timer under fake timers, and the participant list re-rendering on a
// CDC event (simulated here as the mocked hook's return value changing
// across a rerender, exactly how a real CDC-driven state update looks from
// the screen's point of view).

const navigationStub = {} as unknown as Parameters<typeof ActiveSessionScreen>[0]['navigation'];
const routeStub = {
  key: 'ActiveSession',
  name: 'ActiveSession' as const,
  params: { sessionId: 'session-1' },
};

const SESSION_ROW = {
  id: 'session-1',
  host_id: 'host-1',
  venue_id: null,
  type: 'solo' as const,
  status: 'active' as const,
  duration_mode: 'fixed' as const,
  planned_duration_minutes: 30,
  started_at: '2026-07-26T12:00:00.000Z',
  ended_at: null,
  created_at: '2026-07-26T12:00:00.000Z',
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <ActiveSessionScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('ActiveSessionScreen', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-07-26T12:05:00.000Z') });
    mockUseSession.mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the empty state before anyone has joined', async () => {
    mockUseSession.mockReturnValue({ session: SESSION_ROW, openIntervals: [], status: 'active' });

    await renderScreen();

    expect(screen.getByText(en.activeSession.participants.empty)).toBeOnTheScreen();
  });

  it('shows the mapped status label', async () => {
    mockUseSession.mockReturnValue({ session: SESSION_ROW, openIntervals: [], status: 'active' });

    await renderScreen();

    expect(screen.getByText(en.activeSession.status.active)).toBeOnTheScreen();
  });

  it('shows a loading state while the session has not hydrated yet', async () => {
    mockUseSession.mockReturnValue({ session: null, openIntervals: [], status: 'idle' });

    await renderScreen();

    expect(screen.getByTestId('active-session-loading')).toBeOnTheScreen();
  });

  it('counts down remaining minutes for a fixed-duration session and ticks under fake timers', async () => {
    mockUseSession.mockReturnValue({ session: SESSION_ROW, openIntervals: [], status: 'active' });

    await renderScreen();

    // started_at 12:00, now 12:05 (5 minutes elapsed) -> 25 minutes remaining.
    expect(screen.getByTestId('active-session-timer')).toHaveTextContent('25:00');

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('active-session-timer')).toHaveTextContent('24:00');
  });

  it('re-renders the participant list when the hook reports a CDC-driven change', async () => {
    mockUseSession.mockReturnValue({ session: SESSION_ROW, openIntervals: [], status: 'active' });
    const { rerender } = await render(
      <I18nProvider i18n={await initI18n()}>
        <ActiveSessionScreen navigation={navigationStub} route={routeStub} />
      </I18nProvider>,
    );

    expect(screen.getByText(en.activeSession.participants.empty)).toBeOnTheScreen();

    mockUseSession.mockReturnValue({
      session: SESSION_ROW,
      openIntervals: [
        { id: 'i1', session_id: 'session-1', user_id: 'host-1', joined_at: '2026-07-26T12:00:00.000Z', left_at: null },
      ],
      status: 'active',
    });
    await rerender(
      <I18nProvider i18n={await initI18n()}>
        <ActiveSessionScreen navigation={navigationStub} route={routeStub} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.queryByText(en.activeSession.participants.empty)).toBeNull());
    expect(screen.getByTestId('active-session-participant-host-1')).toBeOnTheScreen();
  });

  it('shows the QR token for the host to share when one was passed via navigation', async () => {
    mockUseSession.mockReturnValue({ session: SESSION_ROW, openIntervals: [], status: 'active' });
    const routeWithQr = {
      key: 'ActiveSession',
      name: 'ActiveSession' as const,
      params: { sessionId: 'session-1', qrToken: 'share-this-code' },
    };

    await render(
      <I18nProvider i18n={await initI18n()}>
        <ActiveSessionScreen navigation={navigationStub} route={routeWithQr} />
      </I18nProvider>,
    );

    expect(screen.getByText('share-this-code')).toBeOnTheScreen();
  });
});
