const mockInit = jest.fn();
const mockCaptureException = jest.fn();
jest.mock(
  '@sentry/react-native',
  () => ({
    init: (...args: unknown[]) => mockInit(...args),
    captureException: (...args: unknown[]) => mockCaptureException(...args),
  }),
  { virtual: true },
);

import { initMonitoring } from './monitoring';

// Ports-and-adapters, same posture as apps/server's services/monitoring.ts:
// no Sentry account exists yet, so this stays a real, tested, no-op-when-
// unconfigured seam rather than a call nobody can verify against a real DSN.
describe('initMonitoring', () => {
  beforeEach(() => {
    mockInit.mockReset();
    mockCaptureException.mockReset();
  });

  it('does not initialize Sentry when the DSN is empty (the shipping default)', () => {
    initMonitoring('');

    expect(mockInit).not.toHaveBeenCalled();
  });

  it('initializes Sentry with the DSN when configured', () => {
    initMonitoring('https://example@o1.ingest.sentry.io/1');

    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://example@o1.ingest.sentry.io/1' }),
    );
  });
});
