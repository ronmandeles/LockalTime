import * as Sentry from '@sentry/react-native';

// Ports-and-adapters seam (same shape as apps/server's services/
// monitoring.ts, push-registration.ts): App.tsx's bootstrap calls this
// once, unconditionally, with config/monitoring-config.ts's SENTRY_DSN. An
// empty DSN (the shipping default — no Sentry account exists yet, CLAUDE.md's
// Phase 7 credentials track) keeps this a genuine no-op rather than a call
// that silently fails against a real SDK with no destination.
export const initMonitoring = (dsn: string): void => {
  if (dsn.length === 0) {
    return;
  }
  Sentry.init({ dsn });
};
