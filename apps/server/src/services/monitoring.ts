import * as Sentry from '@sentry/node';

export interface Monitoring {
  captureException(error: unknown): void;
}

// Ports-and-adapters seam (same shape as
// modules/notifications/notification-sender.ts's NotificationSender /
// modules/attestation/attestation-provider.ts): error-handler.ts depends on
// this interface, never Sentry directly, so wiring in a real DSN later
// touches no calling code. No Sentry account exists yet (CLAUDE.md's Phase
// 7 credentials track) -- undefined/empty SENTRY_DSN (config/env.ts) keeps
// this a genuine no-op rather than a call that silently fails against a
// real SDK with no destination.
export const createMonitoring = (dsn: string | undefined): Monitoring => {
  if (dsn === undefined || dsn.length === 0) {
    return { captureException: () => undefined };
  }

  Sentry.init({ dsn });
  return { captureException: (error) => Sentry.captureException(error) };
};
