import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';

const mockJoinSession = jest.fn();
jest.mock('../services/api-client', () => ({
  joinSession: (...args: unknown[]) => mockJoinSession(...args),
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

import SessionDetailsScreen from './SessionDetailsScreen';

// Session Details (Screen 8): the pre-join confirmation — this is where the
// actual join API call happens, so every join-failure code gets its own
// message here (Phase 2 task 2.7's plan explicitly calls this out).

const mockNavigate = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
} as unknown as Parameters<typeof SessionDetailsScreen>[0]['navigation'];
const routeStub = {
  key: 'SessionDetails',
  name: 'SessionDetails' as const,
  params: { token: 'qr-token-value' },
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <SessionDetailsScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('SessionDetailsScreen', () => {
  beforeEach(() => {
    mockJoinSession.mockReset();
    mockNavigate.mockClear();
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
    code                      | expectedMessage
    ${'session_not_found'}    | ${en.sessionDetails.errors.session_not_found}
    ${'session_not_joinable'} | ${en.sessionDetails.errors.session_not_joinable}
    ${'qr_token_expired'}     | ${en.sessionDetails.errors.qr_token_expired}
    ${'session_at_capacity'}  | ${en.sessionDetails.errors.session_at_capacity}
    ${'invalid_qr_token'}     | ${en.sessionDetails.errors.invalid_qr_token}
    ${'some_unmapped_code'}   | ${en.sessionDetails.errors.unknown}
  `('renders the $code failure as its own distinct message', async ({ code, expectedMessage }) => {
    mockJoinSession.mockResolvedValue({ ok: false, error: { code, message: 'diagnostic only' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('session-details-join'));

    expect(await screen.findByText(expectedMessage)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
