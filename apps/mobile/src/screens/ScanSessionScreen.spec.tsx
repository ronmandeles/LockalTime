import React from 'react';

import { act, fireEvent, render, screen } from '@testing-library/react-native';

const mockHasPermission = jest.fn();
const mockRequestPermission = jest.fn();
jest.mock('react-native-vision-camera', () => ({
  useCameraPermission: () => ({
    hasPermission: mockHasPermission(),
    requestPermission: mockRequestPermission,
  }),
}));

let capturedOnScanned: ((value: string) => void) | null = null;
jest.mock('../components/QrCodeCamera', () => ({
  __esModule: true,
  default: (props: { onScanned: (value: string) => void }) => {
    capturedOnScanned = props.onScanned;
    const { View } = jest.requireActual('react-native');
    return <View testID="qr-code-camera-stub" />;
  },
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

import ScanSessionScreen from './ScanSessionScreen';

// Scan (Screen 7), Phase 3 task 3.5: real camera QR scanning, deferred from
// Phase 2 (docs/MANUAL_QA.md) until native linking work was already in
// flight this phase. Camera mode is the default once permission is
// granted; manual entry is always reachable (never a dead-end fallback —
// same "commitment device, not a jail" posture as blocking-permissions).
// react-native-vision-camera and QrCodeCamera are both mocked: the real
// camera/native module has no Jest equivalent (testing-standards's
// native-modules rule) — QrCodeCamera's own manual-QA-pending posture is
// noted in its header comment. Continue/handleScanned both hand the raw
// token to Session Details (8), which owns the actual join API call.

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
    mockHasPermission.mockReset().mockReturnValue(false);
    mockRequestPermission.mockReset();
    capturedOnScanned = null;
  });

  describe('manual entry (no camera permission)', () => {
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

    it('shows an "allow camera access" prompt, not the camera view', async () => {
      await renderScreen();

      expect(screen.getByText(en.scanSession.cameraPermission.allow)).toBeOnTheScreen();
      expect(screen.queryByTestId('qr-code-camera-stub')).toBeNull();
    });

    it('requesting camera access and having it granted switches to camera mode', async () => {
      mockRequestPermission.mockResolvedValue(true);
      await renderScreen();

      await act(async () => {
        fireEvent.press(screen.getByTestId('scan-session-scan-with-camera'));
      });

      expect(mockRequestPermission).toHaveBeenCalledTimes(1);
      expect(screen.getByTestId('qr-code-camera-stub')).toBeOnTheScreen();
    });

    it('requesting camera access and having it denied stays in manual mode', async () => {
      mockRequestPermission.mockResolvedValue(false);
      await renderScreen();

      await act(async () => {
        fireEvent.press(screen.getByTestId('scan-session-scan-with-camera'));
      });

      expect(screen.queryByTestId('qr-code-camera-stub')).toBeNull();
      expect(screen.getByTestId('scan-session-token-input')).toBeOnTheScreen();
    });
  });

  describe('camera mode (permission already granted)', () => {
    beforeEach(() => {
      mockHasPermission.mockReturnValue(true);
    });

    it('renders the camera by default, without requesting permission again', async () => {
      await renderScreen();

      expect(screen.getByTestId('qr-code-camera-stub')).toBeOnTheScreen();
      expect(mockRequestPermission).not.toHaveBeenCalled();
    });

    it('a scanned code navigates to SessionDetails with the decoded token', async () => {
      await renderScreen();

      expect(capturedOnScanned).not.toBeNull();
      await act(async () => {
        capturedOnScanned?.('scanned-token-value');
      });

      expect(mockNavigate).toHaveBeenCalledWith('SessionDetails', { token: 'scanned-token-value' });
    });

    it('ignores a scan whose decoded value is blank', async () => {
      await renderScreen();

      await act(async () => {
        capturedOnScanned?.('   ');
      });

      expect(mockNavigate).not.toHaveBeenCalled();
    });

    it('"enter manually" switches to the manual text-entry view', async () => {
      await renderScreen();

      await fireEvent.press(screen.getByTestId('scan-session-enter-manually'));

      expect(screen.getByTestId('scan-session-token-input')).toBeOnTheScreen();
      expect(screen.queryByTestId('qr-code-camera-stub')).toBeNull();
    });
  });
});
