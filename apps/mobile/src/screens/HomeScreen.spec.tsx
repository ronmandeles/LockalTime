import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import HomeScreen from './HomeScreen';

// Phase 1 i18n foundation: the Home placeholder migrates onto the i18n layer.
// Rendering under the he locale and finding the Hebrew string is the
// strongest "no hardcoded UI strings" assertion available at test level — a
// literal in the component cannot change language. Assertions reference the
// locale modules, never re-typed literals, so copy edits don't break specs.
// react-native-localize is mocked virtually (not installed until Stage B);
// no test reads the machine's real locale.
//
// Phase 2 task 2.7: DESIGN_GUIDELINES §1's reference model — two entry
// points (create/join), no session-lookup on mount (see HomeScreen.tsx's
// header comment for why).

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

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>();

jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => mockGetLocales(),
  }),
  { virtual: true },
);

const mockNavigate = jest.fn();
const navigationStub = { navigate: mockNavigate } as unknown as Parameters<typeof HomeScreen>[0]['navigation'];
const routeStub = { key: 'Home', name: 'Home' as const, params: undefined };

const renderHomeScreenIn = async (locale: 'en' | 'he'): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);

  // RNTL v14 render is async (returns a Promise) — must be awaited.
  await render(
    <I18nProvider i18n={i18n}>
      <HomeScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('HomeScreen', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
    mockNavigate.mockClear();
  });

  it('renders its title from the en bundle when the locale is en', async () => {
    await renderHomeScreenIn('en');

    expect(screen.getByText(en.home.title)).toBeOnTheScreen();
  });

  it('renders the Hebrew title when the locale is he, proving text flows through i18n', async () => {
    // Guard: if the two bundles ever carried the same string for this key,
    // the assertions below would pass against a hardcoded literal too.
    expect(he.home.title).not.toBe(en.home.title);

    await renderHomeScreenIn('he');

    expect(screen.getByText(he.home.title)).toBeOnTheScreen();
    expect(screen.queryByText(en.home.title)).toBeNull();
  });

  it('navigates to CreateSession when the create CTA is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-create-session-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('CreateSession');
  });

  it('navigates to ScanSession when the scan CTA is pressed', async () => {
    await renderHomeScreenIn('en');

    fireEvent.press(screen.getByTestId('home-scan-qr-cta'));

    expect(mockNavigate).toHaveBeenCalledWith('ScanSession');
  });
});
