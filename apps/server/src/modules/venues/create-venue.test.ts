import { createVenue } from './create-venue';
import { verifyVenueQrToken } from './venue-qr-token';
import type { NewVenueInput, VenueRecord, VenuesStore } from './venues-store';

const QR_SECRET = 'qr-signing-secret-at-least-32-characters-long';
const OWNER_ID = '55555555-5555-5555-5555-555555555555';

const buildFakeStore = (): VenuesStore & { insertedVenue: NewVenueInput | null } => {
  const store = {
    insertedVenue: null as NewVenueInput | null,
    async createVenue(input: NewVenueInput): Promise<VenueRecord> {
      store.insertedVenue = input;
      return {
        id: input.id,
        ownerId: input.ownerId,
        name: input.name,
        addressLabel: input.addressLabel,
        qrToken: input.qrToken,
        qrTokenIssuedAt: new Date().toISOString(),
        createdAt: new Date().toISOString(),
      };
    },
    async listVenuesForOwner(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async getVenueById(): Promise<never> {
      throw new Error('not used in these tests');
    },
    async regenerateQrToken(): Promise<never> {
      throw new Error('not used in these tests');
    },
  };
  return store;
};

describe('createVenue', () => {
  it('mints a venue-scoped, verifiable QR token with no expiry field at all', async () => {
    const store = buildFakeStore();

    const venue = await createVenue(store, QR_SECRET, {
      ownerId: OWNER_ID,
      name: "Joe's Cafe",
      addressLabel: null,
    });

    expect(verifyVenueQrToken(venue.qrToken, QR_SECRET)).toEqual({ venueId: venue.id });
    expect(venue).not.toHaveProperty('qrExpiresAt');
  });

  it('generates a fresh venue id for every call', async () => {
    const store = buildFakeStore();
    const input = { ownerId: OWNER_ID, name: 'Cafe', addressLabel: null };

    const first = await createVenue(store, QR_SECRET, input);
    const second = await createVenue(store, QR_SECRET, input);

    expect(first.id).not.toBe(second.id);
    expect(first.qrToken).not.toBe(second.qrToken);
  });

  it('passes owner_id and name through unchanged', async () => {
    const store = buildFakeStore();

    const venue = await createVenue(store, QR_SECRET, {
      ownerId: OWNER_ID,
      name: 'Corner Cafe',
      addressLabel: '123 Main St',
    });

    expect(venue.ownerId).toBe(OWNER_ID);
    expect(venue.name).toBe('Corner Cafe');
    expect(venue.addressLabel).toBe('123 Main St');
  });
});
