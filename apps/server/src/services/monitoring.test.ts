const mockInit = jest.fn();
const mockCaptureException = jest.fn();
jest.mock('@sentry/node', () => ({
  init: (...args: unknown[]) => mockInit(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

import { createMonitoring } from './monitoring';

// Ports-and-adapters, same posture as unconfiguredNotificationSender/
// unconfiguredAttestationProvider: no Sentry account exists yet
// (CLAUDE.md's Phase 7 credentials track), so this stays a real, tested,
// no-op-when-unconfigured seam rather than either a fully wired
// integration nobody can verify against a real DSN, or a TODO.
describe('createMonitoring', () => {
  beforeEach(() => {
    mockInit.mockReset();
    mockCaptureException.mockReset();
  });

  it('does not initialize Sentry and captureException is a no-op when no DSN is configured', () => {
    const monitoring = createMonitoring(undefined);
    monitoring.captureException(new Error('boom'));

    expect(mockInit).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('treats an empty-string DSN the same as undefined', () => {
    const monitoring = createMonitoring('');
    monitoring.captureException(new Error('boom'));

    expect(mockInit).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });

  it('initializes Sentry with the DSN when configured, and forwards captureException', () => {
    const monitoring = createMonitoring('https://example@o1.ingest.sentry.io/1');
    expect(mockInit).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: 'https://example@o1.ingest.sentry.io/1' }),
    );

    const error = new Error('boom');
    monitoring.captureException(error);

    expect(mockCaptureException).toHaveBeenCalledWith(error);
  });
});
