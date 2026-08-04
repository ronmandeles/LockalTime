import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';

// Create Session (Screen 5): mode + duration form -> POST /sessions ->
// navigates to Active Session. Loading/error states per Phase 2 task 2.7's
// test list. api-client is mocked — the real request contract is pinned in
// api-client.test.ts.

const mockCreateSession = jest.fn();
const mockListVenues = jest.fn();
jest.mock('../services/api-client', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  listVenues: () => mockListVenues(),
}));

let mockRole: 'user' | 'verified_host' | 'admin' | null = null;
jest.mock('../state/profile-store', () => ({
  useProfileStore: (selector: (state: { role: typeof mockRole }) => unknown) =>
    selector({ role: mockRole }),
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

import CreateSessionScreen from './CreateSessionScreen';

const mockNavigate = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
} as unknown as Parameters<typeof CreateSessionScreen>[0]['navigation'];
const routeStub = { key: 'CreateSession', name: 'CreateSession' as const, params: undefined };

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <CreateSessionScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('CreateSessionScreen', () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
    mockListVenues.mockReset();
    mockNavigate.mockClear();
    mockRole = null;
  });

  it('defaults to solo + fixed duration', async () => {
    await renderScreen();

    expect(screen.getByTestId('create-session-type-solo')).toHaveProp('accessibilityState', {
      selected: true,
    });
    expect(screen.getByTestId('create-session-duration-fixed')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('rejects submitting a fixed-duration session with no minutes entered (local validation, no request sent)', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.minutesRequired)).toBeOnTheScreen();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('submits the solo/fixed form with the entered minutes and navigates to ActiveSession on success', async () => {
    mockCreateSession.mockResolvedValue({
      ok: true,
      value: { id: 'session-1', qrToken: null },
    });
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
      }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ActiveSession', { sessionId: 'session-1' }),
    );
  });

  it('switches to dynamic_qr and open_ended, then submits without a minutes field at all', async () => {
    mockCreateSession.mockResolvedValue({ ok: true, value: { id: 'session-2', qrToken: 'tok' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-dynamic_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    expect(screen.queryByTestId('create-session-minutes-input')).toBeNull();

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'dynamic_qr',
        duration_mode: 'open_ended',
      }),
    );
  });

  it('shows a loading state while the request is in flight', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    mockCreateSession.mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() => expect(screen.getByTestId('create-session-submit')).toBeDisabled());

    resolveCreate({ ok: true, value: { id: 'session-3', qrToken: null } });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  it('shows an error message and stays on the screen when the request fails', async () => {
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected', message: 'boom' },
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.requestFailed)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('never offers static_qr to a plain user', async () => {
    await renderScreen();

    expect(screen.queryByTestId('create-session-type-static_qr')).toBeNull();
  });

  it('offers static_qr to a verified host and fetches their venues once selected', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: { venues: [{ id: 'venue-1', name: "Joe's Cafe" }] },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));

    expect(await screen.findByText("Joe's Cafe")).toBeOnTheScreen();
  });

  it('requires a venue to be selected before submitting a static_qr session', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: { venues: [{ id: 'venue-1', name: 'Cafe' }] },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await screen.findByText('Cafe');
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.venueRequired)).toBeOnTheScreen();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('submits venue_id once a venue is picked', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: { venues: [{ id: 'venue-1', name: 'Cafe' }] },
    });
    mockCreateSession.mockResolvedValue({
      ok: true,
      value: { id: 'session-4', qrToken: null },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await fireEvent.press(await screen.findByTestId('create-session-venue-venue-1'));
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'static_qr',
        duration_mode: 'open_ended',
        venue_id: 'venue-1',
      }),
    );
  });

  it('maps venue_not_owned/venue_not_found to their own copy', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: { venues: [{ id: 'venue-1', name: 'Cafe' }] },
    });
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'venue_not_owned', message: 'nope' },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await fireEvent.press(await screen.findByTestId('create-session-venue-venue-1'));
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.venueNotOwned)).toBeOnTheScreen();
  });
});
