import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Linking } from 'react-native';

const mockDeleteAccount = jest.fn();
jest.mock('../services/api-client', () => ({
  deleteAccount: (...args: unknown[]) => mockDeleteAccount(...args),
}));

const mockSignOut = jest.fn();
jest.mock('../services/auth-service', () => ({
  signOut: (...args: unknown[]) => mockSignOut(...args),
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
import SettingsScreen from './SettingsScreen';

// Settings (Phase 7, Release Prep): the app's first settings/account
// surface — sign-out (wired to a screen for the first time; auth-service's
// signOut() has existed since Phase 1 but nothing ever called it) plus the
// App/Play Store-mandated account deletion path. Deletion reuses
// EmergencyExitScreen's hold-to-confirm pattern (DESIGN_GUIDELINES §7: an
// irreversible action gets a slower, effortful interaction, not a tap) —
// real timers/waits for the same reason that screen's own spec uses them
// (fake timers fought with RNTL's async auto-cleanup there).

let unmountScreen: (() => void) | undefined;

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  const result = await render(
    <I18nProvider i18n={i18n}>
      <SettingsScreen />
    </I18nProvider>,
  );
  unmountScreen = result.unmount;
};

// Matches SettingsScreen.tsx's HOLD_DURATION_MS.
const HOLD_DURATION_MS = 1500;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe('SettingsScreen', () => {
  beforeEach(() => {
    mockDeleteAccount.mockReset();
    mockSignOut.mockReset();
    jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(async () => {
    await act(async () => {
      unmountScreen?.();
    });
    unmountScreen = undefined;
    jest.restoreAllMocks();
  });

  it('renders the title, sign-out action, legal links, and the delete-account warning', async () => {
    await renderScreen();

    expect(screen.getByText(en.settings.title)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.signOut)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.legal.termsOfService)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.legal.privacyPolicy)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.deleteAccount.title)).toBeOnTheScreen();
    expect(screen.getByText(en.settings.deleteAccount.body)).toBeOnTheScreen();
  });

  it('signs out when the sign-out action is pressed', async () => {
    mockSignOut.mockResolvedValue({ ok: true, value: null });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-sign-out'));
    });

    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('shows an error if sign-out fails, without crashing', async () => {
    mockSignOut.mockResolvedValue({ ok: false, error: { code: 'network_error', message: 'offline' } });
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-sign-out'));
    });

    expect(screen.getByText(en.settings.signOutError)).toBeOnTheScreen();
  });

  it('opens the Terms of Service and Privacy Policy links', async () => {
    await renderScreen();

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-terms-link'));
    });
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/legal/terms'));

    await act(async () => {
      fireEvent.press(screen.getByTestId('settings-privacy-link'));
    });
    expect(Linking.openURL).toHaveBeenCalledWith(expect.stringContaining('/legal/privacy'));
  });

  it('does not delete the account if released before the hold completes', async () => {
    mockDeleteAccount.mockResolvedValue({ ok: true, value: {} });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('settings-delete-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS - 300);
      fireEvent(screen.getByTestId('settings-delete-hold'), 'pressOut');
      await sleep(500);
    });

    expect(mockDeleteAccount).not.toHaveBeenCalled();
  }, 10000);

  it('deletes the account and signs out locally once the hold completes', async () => {
    mockDeleteAccount.mockResolvedValue({ ok: true, value: {} });
    mockSignOut.mockResolvedValue({ ok: true, value: null });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('settings-delete-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  }, 10000);

  it('shows an error and stays on screen when deletion fails, without signing out', async () => {
    mockDeleteAccount.mockResolvedValue({
      ok: false,
      error: { code: 'account_deletion_failed', message: 'nope' },
    });
    await renderScreen();

    await act(async () => {
      fireEvent(screen.getByTestId('settings-delete-hold'), 'pressIn');
      await sleep(HOLD_DURATION_MS + 300);
    });

    expect(screen.getByTestId('settings-delete-error')).toBeOnTheScreen();
    expect(screen.getByText(en.settings.deleteAccount.error)).toBeOnTheScreen();
    expect(mockSignOut).not.toHaveBeenCalled();
  }, 10000);
});
