import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler';
import { createRequireAuth } from '../../middleware/require-auth';
import { createRequireRole } from '../../middleware/require-role';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import type { SessionsStore, VenueMetricsRow } from '../sessions/sessions-store';
import type { UserRole, UsersStore } from '../users/users-store';
import { verifyVenueQrToken } from './venue-qr-token';
import { createVenuesRouter } from './venues.router';
import type { NewVenueInput, VenueRecord, VenuesStore } from './venues-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const buildFakeVenuesStore = (): VenuesStore & { created: NewVenueInput[] } => {
  const created: NewVenueInput[] = [];
  const venues: VenueRecord[] = [];
  return {
    created,
    async createVenue(input) {
      created.push(input);
      const record: VenueRecord = {
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        addressLabel: input.addressLabel,
        qrToken: input.qrToken,
        qrTokenIssuedAt: '2026-07-29T00:00:00.000Z',
        createdAt: '2026-07-29T00:00:00.000Z',
        approvedBlockedCategories: ['social', 'games', 'entertainment'],
        approvedBlockedPackages: [],
      };
      venues.push(record);
      return record;
    },
    async listVenuesForOwner(ownerId) {
      return venues.filter((venue) => venue.ownerId === ownerId);
    },
    async getVenueById(id) {
      return venues.find((venue) => venue.id === id) ?? null;
    },
    async regenerateQrToken(id, ownerId, qrToken) {
      const venue = venues.find((v) => v.id === id && v.ownerId === ownerId);
      if (venue === undefined) {
        return null;
      }
      const index = venues.indexOf(venue);
      const updated: VenueRecord = {
        ...venue,
        qrToken,
        qrTokenIssuedAt: new Date().toISOString(),
      };
      venues[index] = updated;
      return updated;
    },
  };
};

const buildFakeUsersStore = (roles: Record<string, UserRole>): UsersStore => ({
  async getUserRole(userId) {
    return roles[userId] ?? 'user';
  },
  async deleteAccount(): Promise<void> {
    // not exercised by these tests
  },
});

const DEFAULT_METRICS: VenueMetricsRow = {
  concurrentActiveCustomers: 0,
  sessionsInWindow: 0,
  avgMinutesPerCustomer: 0,
};

const buildFakeSessionsStore = (metrics: VenueMetricsRow = DEFAULT_METRICS): SessionsStore =>
  ({
    async getVenueMetrics() {
      return metrics;
    },
  } as unknown as SessionsStore);

const buildApp = (
  store: VenuesStore,
  roles: Record<string, UserRole>,
  sessionsStore: SessionsStore = buildFakeSessionsStore(),
): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/venues',
    createVenuesRouter({
      store,
      sessionsStore,
      qrSigningSecret: QR_SECRET,
      requireAuth: createRequireAuth(jwks.getKey),
      requireVerifiedHost: createRequireRole(buildFakeUsersStore(roles), [
        'verified_host',
        'admin',
      ]),
    }),
  );
  app.use(errorHandler);
  return app;
};

describe('POST /venues', () => {
  it('creates a venue for a verified host, owner_id taken from the token, with a verifiable venue QR token', async () => {
    const token = await jwks.mintToken({ sub: 'host-1' });
    const store = buildFakeVenuesStore();

    const response = await request(buildApp(store, { 'host-1': 'verified_host' }))
      .post('/venues')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: "Joe's Cafe" });

    expect(response.status).toBe(201);
    expect(response.body.ownerId).toBe('host-1');
    expect(verifyVenueQrToken(response.body.qrToken, QR_SECRET)).toEqual({
      venueId: response.body.id,
    });
    expect(store.created).toHaveLength(1);
    expect(store.created[0]).toMatchObject({
      ownerId: 'host-1',
      name: "Joe's Cafe",
      addressLabel: null,
    });
  });

  it('rejects venue creation from a plain user', async () => {
    const token = await jwks.mintToken({ sub: 'plain-1' });
    const store = buildFakeVenuesStore();

    const response = await request(buildApp(store, { 'plain-1': 'user' }))
      .post('/venues')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Sneaky Cafe' });

    expect(response.status).toBe(403);
    expect(store.created).toHaveLength(0);
  });

  it('rejects an unauthenticated request', async () => {
    const store = buildFakeVenuesStore();

    const response = await request(buildApp(store, {})).post('/venues').send({ name: 'Cafe' });

    expect(response.status).toBe(401);
  });

  it('rejects a blank venue name', async () => {
    const token = await jwks.mintToken({ sub: 'host-1' });
    const store = buildFakeVenuesStore();

    const response = await request(buildApp(store, { 'host-1': 'verified_host' }))
      .post('/venues')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: '   ' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_request');
  });
});

describe('GET /venues', () => {
  it("lists only the caller's own venues, not another host's", async () => {
    const store = buildFakeVenuesStore();
    await store.createVenue({
      id: 'venue-1',
      ownerId: 'host-1',
      name: 'Host 1 Cafe',
      addressLabel: null,
      qrToken: 'token-1',
    });
    await store.createVenue({
      id: 'venue-2',
      ownerId: 'host-2',
      name: 'Host 2 Cafe',
      addressLabel: null,
      qrToken: 'token-2',
    });

    const token = await jwks.mintToken({ sub: 'host-1' });
    const response = await request(buildApp(store, { 'host-1': 'verified_host' }))
      .get('/venues')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.venues).toHaveLength(1);
    expect(response.body.venues[0].name).toBe('Host 1 Cafe');
  });

  it('rejects a non-verified-host caller', async () => {
    const store = buildFakeVenuesStore();
    const token = await jwks.mintToken({ sub: 'plain-1' });

    const response = await request(buildApp(store, { 'plain-1': 'user' }))
      .get('/venues')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
  });
});

describe('POST /venues/:id/qr/regenerate', () => {
  it("mints a fresh token for the owner's venue, invalidating the old one", async () => {
    const store = buildFakeVenuesStore();
    await store.createVenue({
      id: 'venue-1',
      ownerId: 'host-1',
      name: 'Host 1 Cafe',
      addressLabel: null,
      qrToken: 'old-token',
    });
    const token = await jwks.mintToken({ sub: 'host-1' });

    const response = await request(buildApp(store, { 'host-1': 'verified_host' }))
      .post('/venues/venue-1/qr/regenerate')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.qrToken).not.toBe('old-token');
    expect(verifyVenueQrToken(response.body.qrToken, QR_SECRET)).toEqual({ venueId: 'venue-1' });
  });

  it("rejects regenerating another host's venue", async () => {
    const store = buildFakeVenuesStore();
    await store.createVenue({
      id: 'venue-1',
      ownerId: 'host-1',
      name: 'Host 1 Cafe',
      addressLabel: null,
      qrToken: 'old-token',
    });
    const token = await jwks.mintToken({ sub: 'host-2' });

    const response = await request(buildApp(store, { 'host-2': 'verified_host' }))
      .post('/venues/venue-1/qr/regenerate')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
  });
});

describe('GET /venues/:id/metrics', () => {
  it("returns the owner's own venue metrics", async () => {
    const store = buildFakeVenuesStore();
    await store.createVenue({
      id: 'venue-1',
      ownerId: 'host-1',
      name: 'Host 1 Cafe',
      addressLabel: null,
      qrToken: 'token',
    });
    const sessionsStore = buildFakeSessionsStore({
      concurrentActiveCustomers: 4,
      sessionsInWindow: 10,
      avgMinutesPerCustomer: 22.5,
    });
    const token = await jwks.mintToken({ sub: 'host-1' });

    const response = await request(buildApp(store, { 'host-1': 'verified_host' }, sessionsStore))
      .get('/venues/venue-1/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      concurrentActiveCustomers: 4,
      sessionsInWindow: 10,
      avgMinutesPerCustomer: 22.5,
    });
  });

  it("rejects a verified host reading another host's venue metrics", async () => {
    const store = buildFakeVenuesStore();
    await store.createVenue({
      id: 'venue-1',
      ownerId: 'host-1',
      name: 'Host 1 Cafe',
      addressLabel: null,
      qrToken: 'token',
    });
    const token = await jwks.mintToken({ sub: 'host-2' });

    const response = await request(
      buildApp(store, { 'host-1': 'verified_host', 'host-2': 'verified_host' }),
    )
      .get('/venues/venue-1/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('venue_not_owned');
  });

  it('rejects a non-verified-host caller before ownership is even checked', async () => {
    const store = buildFakeVenuesStore();
    const token = await jwks.mintToken({ sub: 'plain-1' });

    const response = await request(buildApp(store, { 'plain-1': 'user' }))
      .get('/venues/venue-1/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('insufficient_role');
  });

  it('404s for a venue id that does not exist', async () => {
    const store = buildFakeVenuesStore();
    const token = await jwks.mintToken({ sub: 'host-1' });

    const response = await request(buildApp(store, { 'host-1': 'verified_host' }))
      .get('/venues/no-such-venue/metrics')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('venue_not_found');
  });
});
