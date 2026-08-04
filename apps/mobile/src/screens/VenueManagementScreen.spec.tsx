import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockListVenues = jest.fn();
const mockCreateVenue = jest.fn();
const mockRegenerateVenueQr = jest.fn();
jest.mock('../services/api-client', () => ({
  createVenue: (...args: unknown[]) => mockCreateVenue(...args),
  listVenues: () => mockListVenues(),
  regenerateVenueQr: (...args: unknown[]) => mockRegenerateVenueQr(...args),
}));

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}

const EN_US: DeviceLocaleStub = {
  countryCode: 'US',
  isRTL: false,
  languageCode: 'en',
  languageTag: 'en-US',
};
const mockGetLocales = jest.fn<DeviceLocaleStub[], []>(() => [EN_US]);
jest.mock('react-native-localize', () => ({ getLocales: () => mockGetLocales() }));

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import VenueManagementScreen from './VenueManagementScreen';

const navigationStub = {} as unknown as Parameters<typeof VenueManagementScreen>[0]['navigation'];
const routeStub = { key: 'VenueManagement', name: 'VenueManagement' as const, params: undefined };

const VENUE = {
  id: 'venue-1',
  ownerId: 'user-1',
  name: "Joe's Cafe",
  addressLabel: null,
  qrToken: 'signed-venue-token',
  qrTokenIssuedAt: '2026-07-29T00:00:00.000Z',
  createdAt: '2026-07-29T00:00:00.000Z',
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <VenueManagementScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('VenueManagementScreen', () => {
  beforeEach(() => {
    mockListVenues.mockReset();
    mockCreateVenue.mockReset();
    mockRegenerateVenueQr.mockReset();
  });

  it('shows an empty state for a host with no venues yet', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [] } });

    await renderScreen();

    expect(await screen.findByText(en.venueManagement.empty)).toBeOnTheScreen();
  });

  it("lists the host's venues with their printed QR token", async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE] } });

    await renderScreen();

    expect(await screen.findByText("Joe's Cafe")).toBeOnTheScreen();
    expect(screen.getByTestId('venue-qr-venue-1')).toHaveTextContent('signed-venue-token');
  });

  it('shows a retry affordance when the list fails to load', async () => {
    mockListVenues.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    expect(await screen.findByText(en.venueManagement.loadError)).toBeOnTheScreen();
    expect(screen.getByTestId('venue-management-retry')).toBeOnTheScreen();
  });

  it('rejects a blank venue name locally, without a request', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [] } });
    await renderScreen();
    await screen.findByText(en.venueManagement.empty);

    await fireEvent.press(screen.getByTestId('venue-management-add-submit'));

    expect(await screen.findByText(en.venueManagement.errors.nameRequired)).toBeOnTheScreen();
    expect(mockCreateVenue).not.toHaveBeenCalled();
  });

  it('creates a venue and reloads the list', async () => {
    mockListVenues.mockResolvedValueOnce({ ok: true, value: { venues: [] } });
    mockCreateVenue.mockResolvedValue({ ok: true, value: VENUE });
    mockListVenues.mockResolvedValueOnce({ ok: true, value: { venues: [VENUE] } });
    await renderScreen();
    await screen.findByText(en.venueManagement.empty);

    await fireEvent.changeText(screen.getByTestId('venue-management-name-input'), "Joe's Cafe");
    await fireEvent.press(screen.getByTestId('venue-management-add-submit'));

    await waitFor(() => expect(mockCreateVenue).toHaveBeenCalledWith({ name: "Joe's Cafe" }));
    expect(await screen.findByText("Joe's Cafe")).toBeOnTheScreen();
  });

  it('requires an explicit confirmation before regenerating a venue QR code', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE] } });
    await renderScreen();
    await screen.findByText("Joe's Cafe");

    await fireEvent.press(screen.getByTestId('venue-regenerate-venue-1'));

    expect(screen.getByText(en.venueManagement.regenerateConfirmTitle)).toBeOnTheScreen();
    expect(mockRegenerateVenueQr).not.toHaveBeenCalled();
  });

  it('regenerates the QR code once confirmed', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE] } });
    mockRegenerateVenueQr.mockResolvedValue({
      ok: true,
      value: { ...VENUE, qrToken: 'a-new-signed-venue-token' },
    });
    await renderScreen();
    await screen.findByText("Joe's Cafe");

    await fireEvent.press(screen.getByTestId('venue-regenerate-venue-1'));
    await fireEvent.press(screen.getByTestId('venue-regenerate-confirm-venue-1'));

    await waitFor(() => expect(mockRegenerateVenueQr).toHaveBeenCalledWith('venue-1'));
    expect(await screen.findByText(en.venueManagement.regenerateSuccess)).toBeOnTheScreen();
  });

  it('cancelling the confirmation never calls regenerate', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE] } });
    await renderScreen();
    await screen.findByText("Joe's Cafe");

    await fireEvent.press(screen.getByTestId('venue-regenerate-venue-1'));
    await fireEvent.press(screen.getByTestId('venue-regenerate-cancel-venue-1'));

    expect(screen.queryByText(en.venueManagement.regenerateConfirmTitle)).toBeNull();
    expect(mockRegenerateVenueQr).not.toHaveBeenCalled();
  });
});
