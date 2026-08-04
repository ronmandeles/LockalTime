import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';

const mockJoinSession = jest.fn();
const mockJoinVenueSession = jest.fn();
const mockRejoinSession = jest.fn();
const mockPreviewSession = jest.fn();
jest.mock('../services/api-client', () => ({
  joinSession: (...args: unknown[]) => mockJoinSession(...args),
  joinVenueSession: (...args: unknown[]) => mockJoinVenueSession(...args),
  rejoinSession: (...args: unknown[]) => mockRejoinSession(...args),
  previewSession: (...args: unknown[]) => mockPreviewSession(...args),
}));

const mockFetchSession = jest.fn();
const mockFetchOpenPresenceIntervals = jest.fn();
jest.mock('../services/session-repository', () => ({
  fetchSession: (...args: unknown[]) => mockFetchSession(...args),
  fetchOpenPresenceIntervals: (...args: unknown[]) => mockFetchOpenPresenceIntervals(...args),
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

import SessionDetailsScreen from './SessionDetailsScreen';

// Session Details (Screen 8): the pre-join confirmation — this is where the
// actual join API call happens, so every join-failure code gets its own
// message here. Phase 6 task 7 adds a preview fetch (real details before
// joining) and a per-failure-code recovery affordance; the preview never
// blocks the Join CTA itself (its own failure has a separate retry).

const mockNavigate = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
} as unknown as Parameters<typeof SessionDetailsScreen>[0]['navigation'];
const routeStub = {
  key: 'SessionDetails',
  name: 'SessionDetails' as const,
  params: { token: 'qr-token-value' },
};
const rejoinRouteStub = {
  key: 'SessionDetails',
  name: 'SessionDetails' as const,
  params: { sessionId: 'session-1' },
};

const DEFAULT_PREVIEW = {
  sessionId: 'session-1',
  tokenKind: 'session',
  type: 'dynamic_qr',
  durationMode: 'fixed',
  plannedDurationMinutes: 30,
  status: 'active',
  startedAt: null,
  elapsedMinutes: null,
  participantCount: 1,
  venueName: null,
  completionBonusAvailable: false,
};

const renderScreen = async (
  route: typeof routeStub | typeof rejoinRouteStub = routeStub,
): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <SessionDetailsScreen navigation={navigationStub} route={route} />
    </I18nProvider>,
  );
};

describe('SessionDetailsScreen', () => {
  beforeEach(() => {
    mockJoinSession.mockReset();
    mockJoinVenueSession.mockReset();
    mockRejoinSession.mockReset();
    mockNavigate.mockClear();
    mockPreviewSession.mockReset().mockResolvedValue({ ok: true, value: DEFAULT_PREVIEW });
    mockFetchSession.mockReset().mockResolvedValue({
      ok: true,
      value: { id: 'session-1', started_at: null, status: 'active' },
    });
    mockFetchOpenPresenceIntervals.mockReset().mockResolvedValue({ ok: true, value: [] });
  });

  it('renders the confirmation copy and Join CTA', async () => {
    await renderScreen();

    expect(screen.getByText(en.sessionDetails.title)).toBeOnTheScreen();
    expect(screen.getByTestId('session-details-join')).toBeOnTheScreen();
  });

  it('joins with the token from the route params and navigates to ActiveSession on success', async () => {
    mockJoinSession.mockResolvedValue({ ok: true, value: { sessionId: 'session-1' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('session-details-join'));

    await waitFor(() => expect(mockJoinSession).toHaveBeenCalledWith('qr-token-value'));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ActiveSession', { sessionId: 'session-1' }),
    );
  });

  it('shows a loading state while joining', async () => {
    let resolveJoin: (value: unknown) => void = () => undefined;
    mockJoinSession.mockReturnValue(new Promise((resolve) => (resolveJoin = resolve)));
    await renderScreen();

    await fireEvent.press(screen.getByTestId('session-details-join'));

    await waitFor(() => expect(screen.getByTestId('session-details-join')).toBeDisabled());
    expect(screen.getByText(en.sessionDetails.joining)).toBeOnTheScreen();

    resolveJoin({ ok: true, value: { sessionId: 'session-2' } });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  it.each`
    code                            | expectedMessage
    ${'session_not_found'}          | ${en.sessionDetails.errors.session_not_found}
    ${'session_not_joinable'}       | ${en.sessionDetails.errors.session_not_joinable}
    ${'qr_token_expired'}           | ${en.sessionDetails.errors.qr_token_expired}
    ${'session_at_capacity'}        | ${en.sessionDetails.errors.session_at_capacity}
    ${'invalid_qr_token'}           | ${en.sessionDetails.errors.invalid_qr_token}
    ${'venue_not_found'}            | ${en.sessionDetails.errors.venue_not_found}
    ${'no_active_session_at_venue'} | ${en.sessionDetails.errors.no_active_session_at_venue}
    ${'some_unmapped_code'}         | ${en.sessionDetails.errors.unknown}
  `('renders the $code failure as its own distinct message', async ({ code, expectedMessage }) => {
    mockJoinSession.mockResolvedValue({ ok: false, error: { code, message: 'diagnostic only' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('session-details-join'));

    expect(await screen.findByText(expectedMessage)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  describe('recovery affordance per failure code (Phase 6 task 7)', () => {
    it('navigates to ScanSession for a dead/expired code', async () => {
      mockJoinSession.mockResolvedValue({
        ok: false,
        error: { code: 'qr_token_expired', message: 'x' },
      });
      await renderScreen();
      await fireEvent.press(screen.getByTestId('session-details-join'));
      await screen.findByTestId('session-details-error');

      expect(screen.getByText(en.sessionDetails.recovery.scanAgain)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('session-details-recovery-action'));

      expect(mockNavigate).toHaveBeenCalledWith('ScanSession');
    });

    it('navigates to Home for an unreachable session', async () => {
      mockJoinSession.mockResolvedValue({
        ok: false,
        error: { code: 'session_not_found', message: 'x' },
      });
      await renderScreen();
      await fireEvent.press(screen.getByTestId('session-details-join'));
      await screen.findByTestId('session-details-error');

      expect(screen.getByText(en.sessionDetails.recovery.backToHome)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('session-details-recovery-action'));

      expect(mockNavigate).toHaveBeenCalledWith('Home');
    });

    it('retries the same join for a transient/unmapped failure', async () => {
      mockJoinSession
        .mockResolvedValueOnce({ ok: false, error: { code: 'network_error', message: 'x' } })
        .mockResolvedValueOnce({ ok: true, value: { sessionId: 'session-1' } });
      await renderScreen();
      await fireEvent.press(screen.getByTestId('session-details-join'));
      await screen.findByTestId('session-details-error');

      expect(screen.getByText(en.sessionDetails.recovery.retry)).toBeOnTheScreen();
      await fireEvent.press(screen.getByTestId('session-details-recovery-action'));

      await waitFor(() => expect(mockJoinSession).toHaveBeenCalledTimes(2));
      await waitFor(() =>
        expect(mockNavigate).toHaveBeenCalledWith('ActiveSession', { sessionId: 'session-1' }),
      );
    });
  });

  describe('preview details (Phase 6 task 4/7)', () => {
    it('shows participant count and venue name once the preview resolves', async () => {
      mockPreviewSession.mockResolvedValue({
        ok: true,
        value: { ...DEFAULT_PREVIEW, participantCount: 6, venueName: "Joe's Cafe" },
      });

      await renderScreen();

      expect(await screen.findByTestId('session-details-venue-name')).toHaveTextContent(
        "At Joe's Cafe",
      );
      expect(screen.getByTestId('session-details-participant-count')).toHaveTextContent(
        '6 people here now',
      );
    });

    it('shows the completion-bonus-unavailable note once the session has started past tolerance', async () => {
      mockPreviewSession.mockResolvedValue({
        ok: true,
        value: { ...DEFAULT_PREVIEW, elapsedMinutes: 20, completionBonusAvailable: false },
      });

      await renderScreen();

      expect(await screen.findByTestId('session-details-completion-bonus-note')).toBeOnTheScreen();
    });

    it('does not show the completion-bonus note when still within tolerance', async () => {
      mockPreviewSession.mockResolvedValue({
        ok: true,
        value: { ...DEFAULT_PREVIEW, elapsedMinutes: 0, completionBonusAvailable: true },
      });

      await renderScreen();
      await screen.findByTestId('session-details-participant-count');

      expect(screen.queryByTestId('session-details-completion-bonus-note')).toBeNull();
    });

    it('shows a retry affordance when the preview fails, without blocking the Join CTA', async () => {
      mockPreviewSession.mockResolvedValue({ ok: false, error: { message: 'network error' } });

      await renderScreen();

      expect(await screen.findByTestId('session-details-preview-error')).toBeOnTheScreen();
      expect(screen.getByTestId('session-details-join')).not.toBeDisabled();
    });

    it('calls joinVenueSession instead of joinSession when the preview reports a venue token', async () => {
      mockPreviewSession.mockResolvedValue({
        ok: true,
        value: { ...DEFAULT_PREVIEW, tokenKind: 'venue' },
      });
      mockJoinVenueSession.mockResolvedValue({ ok: true, value: { sessionId: 'session-1' } });
      await renderScreen();
      await screen.findByTestId('session-details-participant-count');

      await fireEvent.press(screen.getByTestId('session-details-join'));

      await waitFor(() => expect(mockJoinVenueSession).toHaveBeenCalledWith('qr-token-value'));
      expect(mockJoinSession).not.toHaveBeenCalled();
    });
  });
});

// Screen 13's "Welcome Back" flow (Phase 4 task 12) reuses this screen for
// a token-free re-entry, routed here by sessionId instead of a scanned
// token (ARCHITECTURE.md §2 item 13: "Rejoin Session -> Session Details
// screen directly, no QR re-scan"). Same screen, same CTA shape — only the
// copy and which api-client function gets called differ.
describe('SessionDetailsScreen (rejoin mode — route params has sessionId, not token)', () => {
  beforeEach(() => {
    mockJoinSession.mockReset();
    mockRejoinSession.mockReset();
    mockNavigate.mockClear();
    mockFetchSession.mockReset().mockResolvedValue({
      ok: true,
      value: { id: 'session-1', started_at: null, status: 'active' },
    });
    mockFetchOpenPresenceIntervals.mockReset().mockResolvedValue({ ok: true, value: [] });
  });

  it('renders rejoin-specific copy and CTA', async () => {
    await renderScreen(rejoinRouteStub);

    expect(screen.getByText(en.sessionDetails.rejoinTitle)).toBeOnTheScreen();
    expect(screen.getByTestId('session-details-join')).toBeOnTheScreen();
  });

  it('rejoins using the sessionId from route params (no token involved) and navigates to ActiveSession', async () => {
    mockRejoinSession.mockResolvedValue({ ok: true, value: { sessionId: 'session-1' } });
    await renderScreen(rejoinRouteStub);

    await fireEvent.press(screen.getByTestId('session-details-join'));

    await waitFor(() => expect(mockRejoinSession).toHaveBeenCalledWith('session-1'));
    expect(mockJoinSession).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ActiveSession', { sessionId: 'session-1' }),
    );
  });

  it('always shows the completion-bonus-unavailable note — a rejoin always means a prior gap', async () => {
    await renderScreen(rejoinRouteStub);

    expect(await screen.findByTestId('session-details-completion-bonus-note')).toBeOnTheScreen();
  });

  it('shows elapsed minutes from the real session row', async () => {
    mockFetchSession.mockResolvedValue({
      ok: true,
      value: {
        id: 'session-1',
        started_at: new Date(Date.now() - 12 * 60_000).toISOString(),
        status: 'active',
      },
    });

    await renderScreen(rejoinRouteStub);

    expect(await screen.findByTestId('session-details-elapsed')).toBeOnTheScreen();
  });

  it.each`
    code                         | expectedMessage
    ${'session_not_found'}       | ${en.sessionDetails.errors.session_not_found}
    ${'session_not_joinable'}    | ${en.sessionDetails.errors.session_not_joinable}
    ${'session_at_capacity'}     | ${en.sessionDetails.errors.session_at_capacity}
    ${'not_a_prior_participant'} | ${en.sessionDetails.errors.not_a_prior_participant}
    ${'some_unmapped_code'}      | ${en.sessionDetails.errors.unknown}
  `('renders the $code failure as its own distinct message', async ({ code, expectedMessage }) => {
    mockRejoinSession.mockResolvedValue({ ok: false, error: { code, message: 'diagnostic only' } });
    await renderScreen(rejoinRouteStub);

    await fireEvent.press(screen.getByTestId('session-details-join'));

    expect(await screen.findByText(expectedMessage)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to Home when a rejoin fails as not_a_prior_participant — the dead-end fix', async () => {
    mockRejoinSession.mockResolvedValue({
      ok: false,
      error: { code: 'not_a_prior_participant', message: 'x' },
    });
    await renderScreen(rejoinRouteStub);
    await fireEvent.press(screen.getByTestId('session-details-join'));
    await screen.findByTestId('session-details-error');

    await fireEvent.press(screen.getByTestId('session-details-recovery-action'));

    expect(mockNavigate).toHaveBeenCalledWith('Home');
  });
});
