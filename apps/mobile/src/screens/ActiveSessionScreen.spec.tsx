import React from 'react';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockUseSession = jest.fn();
jest.mock('../hooks/use-session', () => ({
  useSession: (...args: unknown[]) => mockUseSession(...args),
}));

const mockUseAppBlocker = jest.fn();
jest.mock('../hooks/use-app-blocker', () => ({
  useAppBlocker: (...args: unknown[]) => mockUseAppBlocker(...args),
}));

const mockUseHostMigrationToast = jest.fn();
jest.mock('../hooks/use-host-migration-toast', () => ({
  useHostMigrationToast: (...args: unknown[]) => mockUseHostMigrationToast(...args),
}));

// Mocked directly (not the real store), same reason as
// SessionCompletionScreen.spec.tsx: the real store drags in
// auth-service.ts -> supabase-client.ts -> AsyncStorage (untranspiled),
// and its own contract isn't this suite's concern.
const mockUseAuthStore = jest.fn();
jest.mock('../state/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => mockUseAuthStore(selector),
}));

// Same reason: the real store's own contract (persistence, fail-open) is
// pinned in active-session-store.test.ts — this suite only needs to know
// the screen calls it on mount.
const mockSetActiveSession = jest.fn();
jest.mock('../state/active-session-store', () => ({
  setActiveSession: (...args: unknown[]) => mockSetActiveSession(...args),
}));

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import type { SessionRow } from '../services/session-repository';

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

import ActiveSessionScreen from './ActiveSessionScreen';

// Active Session (Screen 6), DESIGN_GUIDELINES §0: an IN-SESSION surface —
// deliberately quiet, no stimulation beyond what's functionally necessary
// (the timer, the participant list). useSession and useAppBlocker are both
// mocked; their own contracts are pinned in use-session.test.ts and
// use-app-blocker.test.ts respectively — this suite only pins how the
// screen renders their outputs. Per Phase 2 task 2.7's plan: the timer under
// fake timers, and the participant list re-rendering on a CDC event
// (simulated here as the mocked hook's return value changing across a
// rerender). Phase 3 task 3.1 adds the blocker-violation banner.

const mockNavigate = jest.fn();
const mockReset = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
  reset: mockReset,
} as unknown as Parameters<typeof ActiveSessionScreen>[0]['navigation'];
const routeStub = {
  key: 'ActiveSession',
  name: 'ActiveSession' as const,
  params: { sessionId: 'session-1' },
};

const SESSION_ROW: SessionRow = {
  id: 'session-1',
  host_id: 'host-1',
  venue_id: null,
  type: 'solo',
  status: 'active',
  duration_mode: 'fixed',
  planned_duration_minutes: 30,
  started_at: '2026-07-26T12:00:00.000Z',
  ended_at: null,
  created_at: '2026-07-26T12:00:00.000Z',
};

const mockSession = (
  overrides: Partial<SessionRow> | null,
  status: string,
  openIntervals: unknown[] = [],
) => {
  mockUseSession.mockReturnValue({
    session: overrides === null ? null : { ...SESSION_ROW, ...overrides },
    openIntervals,
    status,
    reportOfflineTimeout: jest.fn(),
  });
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
    mockUseAppBlocker.mockReset().mockReturnValue({ violation: null });
    mockUseHostMigrationToast.mockReset().mockReturnValue(false);
    mockUseAuthStore
      .mockReset()
      .mockImplementation((selector: (state: unknown) => unknown) =>
        selector({ auth: { status: 'authenticated', session: { user: { id: 'host-1' } } } }),
      );
    mockNavigate.mockReset();
    mockReset.mockReset();
    mockSetActiveSession.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows the empty state before anyone has joined', async () => {
    mockSession({}, 'active');

    await renderScreen();

    expect(screen.getByText(en.activeSession.participants.empty)).toBeOnTheScreen();
  });

  it('shows the mapped status label', async () => {
    mockSession({}, 'active');

    await renderScreen();

    expect(screen.getByText(en.activeSession.status.active)).toBeOnTheScreen();
  });

  it('shows a loading state while the session has not hydrated yet', async () => {
    mockSession(null, 'idle');

    await renderScreen();

    expect(screen.getByTestId('active-session-loading')).toBeOnTheScreen();
  });

  it('counts down remaining minutes for a fixed-duration session and ticks under fake timers', async () => {
    mockSession({}, 'active');

    await renderScreen();

    // started_at 12:00, now 12:05 (5 minutes elapsed) -> 25 minutes remaining.
    expect(screen.getByTestId('active-session-timer')).toHaveTextContent('25:00');

    await act(async () => {
      jest.advanceTimersByTime(60_000);
    });

    expect(screen.getByTestId('active-session-timer')).toHaveTextContent('24:00');
  });

  it('re-renders the participant list when the hook reports a CDC-driven change', async () => {
    mockSession({}, 'active');
    const { rerender } = await render(
      <I18nProvider i18n={await initI18n()}>
        <ActiveSessionScreen navigation={navigationStub} route={routeStub} />
      </I18nProvider>,
    );

    expect(screen.getByText(en.activeSession.participants.empty)).toBeOnTheScreen();

    mockSession({}, 'active', [
      {
        id: 'i1',
        session_id: 'session-1',
        user_id: 'host-1',
        joined_at: '2026-07-26T12:00:00.000Z',
        left_at: null,
      },
    ]);
    await rerender(
      <I18nProvider i18n={await initI18n()}>
        <ActiveSessionScreen navigation={navigationStub} route={routeStub} />
      </I18nProvider>,
    );

    await waitFor(() => expect(screen.queryByText(en.activeSession.participants.empty)).toBeNull());
    expect(screen.getByTestId('active-session-participant-host-1')).toBeOnTheScreen();
  });

  it('shows the QR token for the host to share when one was passed via navigation', async () => {
    mockSession({}, 'active');
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

  describe('blocker-violation banner (Phase 3 task 3.1)', () => {
    it('shows no banner when there is no violation', async () => {
      mockSession({}, 'active');

      await renderScreen();

      expect(screen.queryByTestId('active-session-blocker-violation')).toBeNull();
    });

    it('shows the permission_revoked message', async () => {
      mockSession({}, 'active');
      mockUseAppBlocker.mockReturnValue({
        violation: { state: 'violation', sessionId: 'session-1', reason: 'permission_revoked' },
      });

      await renderScreen();

      expect(
        screen.getByText(en.activeSession.blockerViolation.message.permission_revoked),
      ).toBeOnTheScreen();
      expect(screen.getByTestId('active-session-blocker-violation-action')).toBeOnTheScreen();
    });

    it('shows the service_killed message', async () => {
      mockSession({}, 'active');
      mockUseAppBlocker.mockReturnValue({
        violation: { state: 'violation', sessionId: 'session-1', reason: 'service_killed' },
      });

      await renderScreen();

      expect(
        screen.getByText(en.activeSession.blockerViolation.message.service_killed),
      ).toBeOnTheScreen();
    });

    it('shows the battery_critical message', async () => {
      mockSession({}, 'active');
      mockUseAppBlocker.mockReturnValue({
        violation: { state: 'violation', sessionId: 'session-1', reason: 'battery_critical' },
      });

      await renderScreen();

      expect(
        screen.getByText(en.activeSession.blockerViolation.message.battery_critical),
      ).toBeOnTheScreen();
    });
  });

  describe('useAppBlocker wiring', () => {
    it('passes an absolute endsAt derived from started_at + planned_duration_minutes for a fixed session', async () => {
      mockSession({}, 'active');

      await renderScreen();

      expect(mockUseAppBlocker).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionId: 'session-1',
          isSessionActive: true,
          endsAt: '2026-07-26T12:30:00.000Z',
        }),
      );
    });

    it('passes a null endsAt for an open-ended session', async () => {
      mockSession({ duration_mode: 'open_ended', planned_duration_minutes: null }, 'active');

      await renderScreen();

      expect(mockUseAppBlocker).toHaveBeenCalledWith(expect.objectContaining({ endsAt: null }));
    });

    it('treats host_disconnected as still session-active — a presence blip must not lift the block', async () => {
      mockSession({}, 'host_disconnected');

      await renderScreen();

      expect(mockUseAppBlocker).toHaveBeenCalledWith(
        expect.objectContaining({ isSessionActive: true }),
      );
    });

    it('is not session-active before the session has hydrated', async () => {
      mockSession(null, 'idle');

      await renderScreen();

      expect(mockUseAppBlocker).toHaveBeenCalledWith(
        expect.objectContaining({ sessionId: null, isSessionActive: false }),
      );
    });
  });

  describe('Emergency Exit link (Screen 9 entry point)', () => {
    it('shows the link while the session is active and navigates to EmergencyExit on press', async () => {
      mockSession({}, 'active');

      await renderScreen();
      fireEvent.press(screen.getByTestId('active-session-emergency-exit'));

      expect(mockNavigate).toHaveBeenCalledWith('EmergencyExit', { sessionId: 'session-1' });
    });

    it('still shows the link during host_disconnected — an ongoing session, not a terminal one', async () => {
      mockSession({}, 'host_disconnected');

      await renderScreen();

      expect(screen.getByTestId('active-session-emergency-exit')).toBeOnTheScreen();
    });

    it('hides the link once the session has completed', async () => {
      mockSession({}, 'completed');

      await renderScreen();

      expect(screen.queryByTestId('active-session-emergency-exit')).toBeNull();
    });
  });

  describe('Welcome Back gate (Phase 4 task 12)', () => {
    it('records this session as the last-active one on mount, for a future Welcome Back prompt', async () => {
      mockSession({}, 'active');

      await renderScreen();

      expect(mockSetActiveSession).toHaveBeenCalledWith('session-1');
    });
  });

  describe('offline banner (Phase 6 task 7)', () => {
    it('shows no offline banner while genuinely active', async () => {
      mockSession({}, 'active');

      await renderScreen();

      expect(screen.queryByTestId('active-session-offline-banner')).toBeNull();
    });

    it('shows a quiet banner for participant_reconnecting', async () => {
      mockSession({}, 'participant_reconnecting');

      await renderScreen();

      expect(screen.getByTestId('active-session-offline-banner')).toBeOnTheScreen();
      expect(
        screen.getByText(en.activeSession.offlineBanner.participant_reconnecting),
      ).toBeOnTheScreen();
    });

    it('shows a prominent banner for degraded_offline', async () => {
      mockSession({}, 'degraded_offline');

      await renderScreen();

      expect(screen.getByText(en.activeSession.offlineBanner.degraded_offline)).toBeOnTheScreen();
    });

    it('shows no offline banner for host_disconnected — that state has its own toast, not this banner', async () => {
      mockSession({}, 'host_disconnected');

      await renderScreen();

      expect(screen.queryByTestId('active-session-offline-banner')).toBeNull();
    });
  });

  describe('terminal-status navigation (Phase 6 task 7 — the stranded-participant fix)', () => {
    it('resets into SessionCompletion once the status becomes completed', async () => {
      mockSession({}, 'completed');

      await renderScreen();

      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'SessionCompletion', params: { sessionId: 'session-1' } }],
      });
    });

    it('resets into SessionCompletion once the status becomes force_terminated', async () => {
      mockSession({}, 'force_terminated');

      await renderScreen();

      expect(mockReset).toHaveBeenCalledWith({
        index: 0,
        routes: [{ name: 'SessionCompletion', params: { sessionId: 'session-1' } }],
      });
    });

    it('never navigates away while the session is still ongoing', async () => {
      mockSession({}, 'active');

      await renderScreen();

      expect(mockReset).not.toHaveBeenCalled();
    });
  });

  describe('host-migration toast', () => {
    it('shows the toast and passes the current session/user ids through when the hook says so', async () => {
      mockSession({ host_id: 'host-1' }, 'active');
      mockUseHostMigrationToast.mockReturnValue(true);

      await renderScreen();

      expect(screen.getByTestId('active-session-host-migration-toast')).toBeOnTheScreen();
      expect(screen.getByText(en.activeSession.hostMigrationToast)).toBeOnTheScreen();
      expect(mockUseHostMigrationToast).toHaveBeenCalledWith('host-1', 'host-1');
    });

    it('shows no toast when the hook reports no migration', async () => {
      mockSession({}, 'active');
      mockUseHostMigrationToast.mockReturnValue(false);

      await renderScreen();

      expect(screen.queryByTestId('active-session-host-migration-toast')).toBeNull();
    });
  });
});
