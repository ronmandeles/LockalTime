import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockLeaveSession = jest.fn();
jest.mock('../services/api-client', () => ({
  leaveSession: (...args: unknown[]) => mockLeaveSession(...args),
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
import EmergencyExitScreen from './EmergencyExitScreen';

// Emergency Exit (Screen 9), DESIGN_GUIDELINES §0/§7: an in-session
// surface, deliberately quiet, with a *slower, effortful* hold-to-confirm
// interaction (not a tap) for this one high-stakes/irreversible action.
// Real timers, real waits — the screen's confirmation timing is a plain
// setTimeout, and driving it under fake timers here fought badly with
// @testing-library/react-native's own async auto-cleanup (overlapping
// act() scopes corrupting later tests in the file); real waits cost a few
// extra seconds of suite time but are simple and reliable.

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const mockGoBack = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
  reset: mockReset,
  goBack: mockGoBack,
} as unknown as Parameters<typeof EmergencyExitScreen>[0]['navigation'];
const routeStub = {
  key: 'EmergencyExit',
  name: 'EmergencyExit' as const,
  params: { sessionId: 'session-1' },
};

// Captured so afterEach can unmount explicitly rather than relying on
// @testing-library/react-native's own async auto-cleanup timing, which
// fought with this screen's real setTimeout-driven confirmation across
// sequential tests in this file.
let unmountScreen: (() => void) | undefined;

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  const result = await render(
    <I18nProvider i18n={i18n}>
      <EmergencyExitScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
  unmountScreen = result.unmount;
};

// Matches EmergencyExitScreen.tsx's HOLD_DURATION_MS.
const HOLD_DURATION_MS = 1500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('EmergencyExitScreen', () => {
  beforeEach(() => {
    mockLeaveSession.mockReset();
    mockNavigate.mockReset();
    mockReset.mockReset();
    mockGoBack.mockReset();
  });

  afterEach(async () => {
    await act(async () => {
      unmountScreen?.();
    });
    unmountScreen = undefined;
  });

  it('renders the title and warning body', async () => {
    await renderScreen();

    expect(screen.getByText(en.emergencyExit.title)).toBeOnTheScreen();
    expect(screen.getByText(en.emergencyExit.body)).toBeOnTheScreen();
  });

  it('does not exit if released before the hold completes', async () => {
    mockLeaveSession.mockResolvedValue({ ok: true, value: { left: true } });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS - 300);
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressOut');
      await sleep(500); // past the original threshold — must never fire late
    });

    expect(mockLeaveSession).not.toHaveBeenCalled();
  }, 10000);

  it('exits and navigates to SessionCompletion once the hold completes', async () => {
    mockLeaveSession.mockResolvedValue({ ok: true, value: { left: true } });
    await renderScreen();

    // Real-time wait wrapped in an async act() so React tracks the state
    // updates that fire during it (setExiting, then the post-await
    // navigation.reset), rather than leaving them to be discovered only by
    // waitFor's own polling.
    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(mockLeaveSession).toHaveBeenCalledWith('session-1', 'emergency_exit');
    expect(mockReset).toHaveBeenCalledWith({
      index: 0,
      routes: [{ name: 'SessionCompletion', params: { sessionId: 'session-1' } }],
    });
  }, 10000);

  it('re-arms after a released hold — a later full hold still exits', async () => {
    mockLeaveSession.mockResolvedValue({ ok: true, value: { left: true } });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS - 300);
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressOut');
    });

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(mockLeaveSession).toHaveBeenCalledTimes(1);
    expect(mockReset).toHaveBeenCalled();
  }, 10000);

  it('shows an error and stays on screen when the exit request fails, without crashing', async () => {
    mockLeaveSession.mockResolvedValue({ ok: false, error: { code: 'network_error', message: 'offline' } });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(screen.getByTestId('emergency-exit-error')).toBeOnTheScreen();
    expect(screen.getByText(en.emergencyExit.errors.requestFailed)).toBeOnTheScreen();
    expect(mockReset).not.toHaveBeenCalled();
  }, 10000);

  it('allows retrying the hold after a failed attempt', async () => {
    mockLeaveSession
      .mockResolvedValueOnce({ ok: false, error: { code: 'network_error', message: 'offline' } })
      .mockResolvedValueOnce({ ok: true, value: { left: true } });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });
    expect(mockLeaveSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      fireEvent(screen.getByTestId('emergency-exit-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(mockLeaveSession).toHaveBeenCalledTimes(2);
    expect(mockReset).toHaveBeenCalled();
  }, 10000);

  it('navigates back when Cancel is pressed', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('emergency-exit-cancel'));
    });

    expect(mockGoBack).toHaveBeenCalledTimes(1);
    expect(mockLeaveSession).not.toHaveBeenCalled();
  });
});
