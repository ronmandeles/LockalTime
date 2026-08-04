import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockListVenues = jest.fn();
const mockGetVenueMetrics = jest.fn();
jest.mock('../services/api-client', () => ({
  listVenues: () => mockListVenues(),
  getVenueMetrics: (...args: unknown[]) => mockGetVenueMetrics(...args),
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
import VenueDashboardScreen from './VenueDashboardScreen';

const navigationStub = {} as unknown as Parameters<typeof VenueDashboardScreen>[0]['navigation'];
const routeStub = { key: 'VenueDashboard', name: 'VenueDashboard' as const, params: undefined };

const VENUE_A = { id: 'venue-a', ownerId: 'user-1', name: 'Venue A' };
const VENUE_B = { id: 'venue-b', ownerId: 'user-1', name: 'Venue B' };

const METRICS = {
  concurrentActiveCustomers: 7,
  sessionsInWindow: 40,
  avgMinutesPerCustomer: 33.4,
  windowDays: 30,
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <VenueDashboardScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('VenueDashboardScreen', () => {
  beforeEach(() => {
    mockListVenues.mockReset();
    mockGetVenueMetrics.mockReset();
  });

  it('shows an empty state for a host with no venues yet', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [] } });

    await renderScreen();

    expect(await screen.findByText(en.venueDashboard.noVenues)).toBeOnTheScreen();
    expect(mockGetVenueMetrics).not.toHaveBeenCalled();
  });

  it('auto-selects the only venue and shows its metrics', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE_A] } });
    mockGetVenueMetrics.mockResolvedValue({ ok: true, value: METRICS });

    await renderScreen();

    await waitFor(() => expect(mockGetVenueMetrics).toHaveBeenCalledWith('venue-a'));
    expect(screen.getByTestId('venue-dashboard-concurrent')).toHaveTextContent('7');
    expect(screen.getByTestId('venue-dashboard-avg-minutes')).toHaveTextContent('33');
  });

  it('lets a host with multiple venues switch between them', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE_A, VENUE_B] } });
    mockGetVenueMetrics.mockResolvedValue({ ok: true, value: METRICS });
    await renderScreen();
    await waitFor(() => expect(mockGetVenueMetrics).toHaveBeenCalledWith('venue-a'));

    await fireEvent.press(screen.getByTestId('venue-dashboard-venue-venue-b'));

    await waitFor(() => expect(mockGetVenueMetrics).toHaveBeenCalledWith('venue-b'));
  });

  it('shows a retry affordance when the venue list fails to load', async () => {
    mockListVenues.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    expect(await screen.findByText(en.venueDashboard.loadError)).toBeOnTheScreen();
    expect(screen.getByTestId('venue-dashboard-retry')).toBeOnTheScreen();
  });

  it('shows a retry affordance when the metrics fetch fails', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE_A] } });
    mockGetVenueMetrics.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    expect(await screen.findByTestId('venue-dashboard-metrics-retry')).toBeOnTheScreen();
  });

  it('refetches metrics when the refresh link is pressed', async () => {
    mockListVenues.mockResolvedValue({ ok: true, value: { venues: [VENUE_A] } });
    mockGetVenueMetrics.mockResolvedValue({ ok: true, value: METRICS });
    await renderScreen();
    await waitFor(() => expect(mockGetVenueMetrics).toHaveBeenCalledTimes(1));

    await fireEvent.press(screen.getByTestId('venue-dashboard-refresh'));

    await waitFor(() => expect(mockGetVenueMetrics).toHaveBeenCalledTimes(2));
  });
});
