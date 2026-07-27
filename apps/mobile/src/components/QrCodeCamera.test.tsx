import React from 'react';

import { render, screen } from '@testing-library/react-native';

const mockUseCameraDevice = jest.fn();
let capturedCodeScanner: { onCodeScanned: (codes: Array<{ value?: string }>) => void } | undefined;

jest.mock('react-native-vision-camera', () => ({
  Camera: (props: { testID?: string }) => {
    const { View } = jest.requireActual('react-native');
    return <View {...props} />;
  },
  useCameraDevice: (...args: unknown[]) => mockUseCameraDevice(...args),
  useCodeScanner: (config: { onCodeScanned: (codes: Array<{ value?: string }>) => void }) => {
    capturedCodeScanner = config;
    return config;
  },
}));

import QrCodeCamera from './QrCodeCamera';

// Phase 3 task 3.5 (backlog.md): react-native-vision-camera is mocked
// entirely — no real camera exists in Jest (testing-standards's
// native-modules rule); the real behavior is manual QA pending
// (docs/MANUAL_QA.md). This suite pins QrCodeCamera's own thin logic: it
// renders nothing without a device, and turns scanned codes into decoded
// string values, ignoring codes with no decodable value.

describe('QrCodeCamera', () => {
  beforeEach(() => {
    mockUseCameraDevice.mockReset();
    capturedCodeScanner = undefined;
  });

  it('renders nothing when no back camera device is available', async () => {
    mockUseCameraDevice.mockReturnValue(undefined);

    await render(<QrCodeCamera onScanned={() => {}} />);

    expect(screen.queryByTestId('qr-code-camera')).toBeNull();
  });

  it('renders the Camera when a device is available', async () => {
    mockUseCameraDevice.mockReturnValue({ id: 'back-camera' });

    await render(<QrCodeCamera onScanned={() => {}} />);

    expect(screen.getByTestId('qr-code-camera')).toBeOnTheScreen();
  });

  it('calls onScanned with the first decodable code value', async () => {
    mockUseCameraDevice.mockReturnValue({ id: 'back-camera' });
    const onScanned = jest.fn();

    await render(<QrCodeCamera onScanned={onScanned} />);
    capturedCodeScanner?.onCodeScanned([{}, { value: 'decoded-token' }]);

    expect(onScanned).toHaveBeenCalledWith('decoded-token');
  });

  it('does not call onScanned when no code in the batch has a decodable value', async () => {
    mockUseCameraDevice.mockReturnValue({ id: 'back-camera' });
    const onScanned = jest.fn();

    await render(<QrCodeCamera onScanned={onScanned} />);
    capturedCodeScanner?.onCodeScanned([{}]);

    expect(onScanned).not.toHaveBeenCalled();
  });
});
