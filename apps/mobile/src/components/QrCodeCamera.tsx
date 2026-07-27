import React from 'react';
import { StyleSheet } from 'react-native';

import { Camera, useCameraDevice, useCodeScanner } from 'react-native-vision-camera';

// Phase 3 task 3.5 (backlog.md): the real camera QR scanner, deferred from
// Phase 2 (docs/MANUAL_QA.md) until native Pod/Gradle linking work was
// already in flight this phase. Deliberately thin — all the scan-result
// handling (what a scanned value means, navigation) stays in
// ScanSessionScreen; this component only turns camera frames into decoded
// QR string values. ScanSessionScreen's own tests mock this component
// entirely (same pattern as ActiveSessionScreen mocking useAppBlocker) since
// react-native-vision-camera has no real camera in Jest.
export interface QrCodeCameraProps {
  readonly onScanned: (value: string) => void;
}

const QrCodeCamera = ({ onScanned }: QrCodeCameraProps): React.JSX.Element | null => {
  const device = useCameraDevice('back');
  const codeScanner = useCodeScanner({
    codeTypes: ['qr'],
    onCodeScanned: (codes) => {
      const value = codes.find((code) => code.value !== undefined)?.value;
      if (value !== undefined) {
        onScanned(value);
      }
    },
  });

  // No back camera available (e.g. some tablets/emulators) — the caller
  // falls back to manual entry, which is always available regardless.
  if (device === undefined) {
    return null;
  }

  return (
    <Camera
      style={StyleSheet.absoluteFill}
      device={device}
      isActive={true}
      codeScanner={codeScanner}
      testID="qr-code-camera"
    />
  );
};

export default QrCodeCamera;
