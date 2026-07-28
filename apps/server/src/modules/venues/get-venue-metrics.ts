import { VENUE_METRICS_WINDOW_DAYS } from '../../config/constants';
import type { SessionsStore } from '../sessions/sessions-store';
import type { VenuesStore } from './venues-store';

export interface VenueMetrics {
  readonly concurrentActiveCustomers: number;
  readonly sessionsInWindow: number;
  readonly avgMinutesPerCustomer: number;
  readonly windowDays: number;
}

export type GetVenueMetricsResult =
  | { readonly outcome: 'ok'; readonly metrics: VenueMetrics }
  | { readonly outcome: 'venue_not_found' | 'venue_not_owned' };

// Ownership check happens here, not just at the router's requireVerifiedHost
// gate: role alone would let any verified host read ANY venue's metrics —
// ownership, not role, is the read scope (same split as venues.router.ts's
// GET /venues). Aggregates only, never individual customers
// (ARCHITECTURE.md §10's MVP scope) — see get_venue_metrics()'s migration
// for why the averaging itself happens in one SQL function.
export const getVenueMetrics = async (
  venuesStore: VenuesStore,
  sessionsStore: SessionsStore,
  venueId: string,
  callerId: string,
  now: () => Date = () => new Date(),
): Promise<GetVenueMetricsResult> => {
  const venue = await venuesStore.getVenueById(venueId);
  if (venue === null) {
    return { outcome: 'venue_not_found' };
  }
  if (venue.ownerId !== callerId) {
    return { outcome: 'venue_not_owned' };
  }

  const windowStart = new Date(
    now().getTime() - VENUE_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const row = await sessionsStore.getVenueMetrics(venueId, windowStart);

  return {
    outcome: 'ok',
    metrics: {
      concurrentActiveCustomers: row.concurrentActiveCustomers,
      sessionsInWindow: row.sessionsInWindow,
      avgMinutesPerCustomer: row.avgMinutesPerCustomer,
      windowDays: VENUE_METRICS_WINDOW_DAYS,
    },
  };
};
