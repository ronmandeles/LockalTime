import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';

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

import ScanSessionScreen from './ScanSessionScreen';

// Scan (Screen 7): Phase 2 has no camera dependency this machine can
// install-and-verify (services/qr-scanner.ts's header comment explains why)
// — manual entry IS the join flow this phase, not a fallback. Continue
// hands the raw token to Session Details (8), which owns the actual join
// API call (the pre-join confirmation step).

const mockNavigate = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
} as unknown as Parameters<typeof ScanSessionScreen>[0]['navigation'];
const routeStub = { key: 'ScanSession', name: 'ScanSession' as const, params: undefined };

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <ScanSessionScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('ScanSessionScreen', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('rejects continuing with an empty code', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('scan-session-continue'));

    expect(await screen.findByText(en.scanSession.errors.tokenRequired)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('navigates to SessionDetails with the entered token', async () => {
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('scan-session-token-input'), '  raw-token-value  ');
    await fireEvent.press(screen.getByTestId('scan-session-continue'));

    expect(mockNavigate).toHaveBeenCalledWith('SessionDetails', { token: 'raw-token-value' });
  });
});
