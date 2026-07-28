import { VENUE_METRICS_WINDOW_DAYS } from '../../config/constants';
import type { SessionsStore, VenueMetricsRow } from '../sessions/sessions-store';
import { getVenueMetrics } from './get-venue-metrics';
import type { VenueRecord, VenuesStore } from './venues-store';

const OWNER_ID = 'host-1';
const VENUE_ID = '88888888-8888-8888-8888-888888888888';
const NOW = new Date('2026-07-29T12:00:00.000Z');
const now = (): Date => NOW;

const VENUE: VenueRecord = {
  id: VENUE_ID,
  ownerId: OWNER_ID,
  name: "Joe's Cafe",
  addressLabel: null,
  qrToken: 'venue-token',
  qrTokenIssuedAt: '2026-07-01T00:00:00.000Z',
  createdAt: '2026-07-01T00:00:00.000Z',
};

const buildFakeVenuesStore = (venue: VenueRecord | null): VenuesStore => ({
  async createVenue(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async listVenuesForOwner(): Promise<never> {
    throw new Error('not used in these tests');
  },
  async getVenueById() {
    return venue;
  },
  async regenerateQrToken(): Promise<never> {
    throw new Error('not used in these tests');
  },
});

const buildFakeSessionsStore = (
  metrics: VenueMetricsRow,
): SessionsStore & { calledWith: { venueId: string; windowStart: string } | null } => {
  const store = {
    calledWith: null as { venueId: string; windowStart: string } | null,
    async getVenueMetrics(venueId: string, windowStart: string) {
      store.calledWith = { venueId, windowStart };
      return metrics;
    },
  };
  return store as unknown as SessionsStore & {
    calledWith: { venueId: string; windowStart: string } | null;
  };
};

describe('getVenueMetrics', () => {
  it("returns venue_not_found for a venue id that doesn't exist", async () => {
    const result = await getVenueMetrics(
      buildFakeVenuesStore(null),
      buildFakeSessionsStore({
        concurrentActiveCustomers: 0,
        sessionsInWindow: 0,
        avgMinutesPerCustomer: 0,
      }),
      VENUE_ID,
      OWNER_ID,
      now,
    );

    expect(result).toEqual({ outcome: 'venue_not_found' });
  });

  it("rejects a caller who isn't the venue's owner", async () => {
    const result = await getVenueMetrics(
      buildFakeVenuesStore(VENUE),
      buildFakeSessionsStore({
        concurrentActiveCustomers: 0,
        sessionsInWindow: 0,
        avgMinutesPerCustomer: 0,
      }),
      VENUE_ID,
      'someone-elses-id',
      now,
    );

    expect(result).toEqual({ outcome: 'venue_not_owned' });
  });

  it('returns the metrics with the window in days for the real owner', async () => {
    const sessionsStore = buildFakeSessionsStore({
      concurrentActiveCustomers: 5,
      sessionsInWindow: 42,
      avgMinutesPerCustomer: 37.5,
    });

    const result = await getVenueMetrics(
      buildFakeVenuesStore(VENUE),
      sessionsStore,
      VENUE_ID,
      OWNER_ID,
      now,
    );

    expect(result).toEqual({
      outcome: 'ok',
      metrics: {
        concurrentActiveCustomers: 5,
        sessionsInWindow: 42,
        avgMinutesPerCustomer: 37.5,
        windowDays: VENUE_METRICS_WINDOW_DAYS,
      },
    });
    expect(sessionsStore.calledWith?.venueId).toBe(VENUE_ID);
    const expectedWindowStart = new Date(
      NOW.getTime() - VENUE_METRICS_WINDOW_DAYS * 24 * 60 * 60 * 1000,
    ).toISOString();
    expect(sessionsStore.calledWith?.windowStart).toBe(expectedWindowStart);
  });
});
