import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockFetchSession = jest.fn();
jest.mock('../services/session-repository', () => ({
  fetchSession: (...args: unknown[]) => mockFetchSession(...args),
}));

const mockClearActiveSession = jest.fn();
const mockResolveWelcomeBack = jest.fn();
jest.mock('../state/active-session-store', () => ({
  clearActiveSession: (...args: unknown[]) => mockClearActiveSession(...args),
  resolveWelcomeBack: (...args: unknown[]) => mockResolveWelcomeBack(...args),
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
import WelcomeBackScreen from './WelcomeBackScreen';

// Screen 13 — Welcome Back / Session Interrupted (Phase 4 task 12,
// ARCHITECTURE.md §2 item 13). A pre-navigator conditional gate, same shape
// as OnboardingScreen/PermissionPrimingScreen (App.tsx renders it outside
// the NavigationContainer): it resolves what App.tsx's one subsequent
// Navigator mount should do, via resolveWelcomeBack(), rather than
// navigating itself. Shows elapsed presence TIME, never a points figure —
// an in-progress session has no authoritative points value yet (bonuses
// aren't decided until it ends), and the Money-Equivalent Logic Rule
// forbids showing anything else (CLAUDE.md).

const SESSION_ID = 'session-1';

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <WelcomeBackScreen sessionId={SESSION_ID} />
    </I18nProvider>,
  );
};

describe('WelcomeBackScreen', () => {
  beforeEach(() => {
    mockFetchSession.mockReset();
    mockClearActiveSession.mockReset();
    mockResolveWelcomeBack.mockReset();
    jest.useFakeTimers({ now: new Date('2026-07-28T12:30:00.000Z') });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows a loading state before the fetch resolves', async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    mockFetchSession.mockReturnValue(new Promise((resolve) => (resolveFetch = resolve)));

    await renderScreen();

    expect(screen.getByTestId('welcome-back-loading')).toBeOnTheScreen();

    resolveFetch({ ok: true, value: { status: 'active', started_at: '2026-07-28T12:00:00.000Z' } });
    await waitFor(() => expect(screen.getByTestId('welcome-back-rejoin')).toBeOnTheScreen());
  });

  it('shows elapsed minutes and a Rejoin CTA for a still-active session', async () => {
    mockFetchSession.mockResolvedValue({
      ok: true,
      value: { status: 'active', started_at: '2026-07-28T12:00:00.000Z' },
    });

    await renderScreen();

    expect(await screen.findByText(en.welcomeBack.title)).toBeOnTheScreen();
    // 12:00 -> 12:30 = 30 minutes elapsed.
    expect(screen.getByText('30 minutes into this session so far')).toBeOnTheScreen();
    expect(screen.getByTestId('welcome-back-rejoin')).toBeOnTheScreen();
    expect(mockResolveWelcomeBack).not.toHaveBeenCalled();
    expect(mockClearActiveSession).not.toHaveBeenCalled();
  });

  it('shows the Rejoin CTA with no elapsed-time line for a still-pending session (not started yet)', async () => {
    mockFetchSession.mockResolvedValue({ ok: true, value: { status: 'pending', started_at: null } });

    await renderScreen();

    expect(screen.getByTestId('welcome-back-rejoin')).toBeOnTheScreen();
    expect(screen.queryByText(/minutes into this session/)).toBeNull();
  });

  it('resolves to a SessionDetails rejoin when the Rejoin CTA is pressed, without clearing the active-session flag', async () => {
    mockFetchSession.mockResolvedValue({
      ok: true,
      value: { status: 'active', started_at: '2026-07-28T12:00:00.000Z' },
    });
    await renderScreen();
    await screen.findByTestId('welcome-back-rejoin');

    fireEvent.press(screen.getByTestId('welcome-back-rejoin'));

    expect(mockResolveWelcomeBack).toHaveBeenCalledWith({ screen: 'SessionDetails', sessionId: SESSION_ID });
    expect(mockClearActiveSession).not.toHaveBeenCalled();
  });

  it('auto-resolves to SessionCompletion and clears the active-session flag when the session already ended', async () => {
    mockFetchSession.mockResolvedValue({
      ok: true,
      value: { status: 'completed', started_at: '2026-07-28T12:00:00.000Z' },
    });

    await renderScreen();

    await waitFor(() =>
      expect(mockResolveWelcomeBack).toHaveBeenCalledWith({
        screen: 'SessionCompletion',
        sessionId: SESSION_ID,
      }),
    );
    expect(mockClearActiveSession).toHaveBeenCalled();
  });

  it('auto-resolves to nothing (Home) and clears the flag when the session no longer exists', async () => {
    mockFetchSession.mockResolvedValue({ ok: false, error: { message: 'not found' } });

    await renderScreen();

    await waitFor(() => expect(mockResolveWelcomeBack).toHaveBeenCalledWith(null));
    expect(mockClearActiveSession).toHaveBeenCalled();
  });
});
