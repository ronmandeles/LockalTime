import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';

// Create Session (Screen 5): mode + duration form -> POST /sessions ->
// navigates to Active Session. Loading/error states per Phase 2 task 2.7's
// test list. api-client is mocked — the real request contract is pinned in
// api-client.test.ts.

const mockCreateSession = jest.fn();
const mockListVenues = jest.fn();
jest.mock('../services/api-client', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  listVenues: () => mockListVenues(),
}));

let mockRole: 'user' | 'verified_host' | 'admin' | null = null;
jest.mock('../state/profile-store', () => ({
  useProfileStore: (selector: (state: { role: typeof mockRole }) => unknown) =>
    selector({ role: mockRole }),
}));

// Phase 9: the persisted blocklist preference is mocked rather than
// exercised here — blocklist-preference-store.test.ts owns its behaviour,
// and importing it for real drags AsyncStorage into a screen spec that has
// nothing to say about storage. BlocklistPicker itself stays REAL, so these
// tests cover the screen-to-picker wiring rather than a stub of it.
const DEFAULT_SELECTION = {
  categories: ['social', 'games', 'entertainment'],
  packages: [] as readonly string[],
};
let mockPreference: { status: string; selection?: unknown } = {
  status: 'ready',
  selection: DEFAULT_SELECTION,
};
const mockRememberBlocklistPreference = jest.fn();
jest.mock('../state/blocklist-preference-store', () => ({
  DEFAULT_BLOCKLIST_SELECTION: { categories: ['social', 'games', 'entertainment'], packages: [] },
  rememberBlocklistPreference: (...args: unknown[]) => mockRememberBlocklistPreference(...args),
  useBlocklistPreferenceStore: (selector: (state: { preference: unknown }) => unknown) =>
    selector({ preference: mockPreference }),
}));

const mockListApps = jest.fn();
jest.mock('../services/blockable-app-source', () => ({
  blockableAppSource: { listApps: () => mockListApps() },
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

import CreateSessionScreen from './CreateSessionScreen';

const mockNavigate = jest.fn();
const navigationStub = {
  navigate: mockNavigate,
} as unknown as Parameters<typeof CreateSessionScreen>[0]['navigation'];
const routeStub = { key: 'CreateSession', name: 'CreateSession' as const, params: undefined };

// Presses a blocklist toggle and waits for the state change to actually
// commit before returning.
//
// The wait is not ceremony. BlocklistPicker's FlatList schedules its own
// cell-render work on a timer, which keeps an act() scope open across the
// press — so a plain fireEvent can return before React has re-rendered, and
// the very next press then runs against a handler closed over the previous
// selection. Asserting the committed accessibilityState is what makes each
// step ordered.
const pressAndSettle = async (
  testID: string,
  expectedState: { checked: boolean },
): Promise<void> => {
  fireEvent.press(screen.getByTestId(testID));
  await waitFor(() =>
    expect(screen.getByTestId(testID)).toHaveProp('accessibilityState', expectedState),
  );
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <CreateSessionScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
  // Wait for the blocklist picker's async app-source read to land before any
  // test interacts. Without this the FlatList's own cell-render timer is
  // still holding an act() scope open when the first press arrives, and the
  // press can be observed before the render it triggered — reliably under
  // full-suite load, only intermittently when this file runs alone.
  await waitFor(() => expect(screen.getByTestId('blocklist-app-list')).toBeOnTheScreen());
};

describe('CreateSessionScreen', () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
    mockListVenues.mockReset();
    mockNavigate.mockClear();
    mockRememberBlocklistPreference.mockReset();
    mockRememberBlocklistPreference.mockResolvedValue(undefined);
    mockListApps.mockReset();
    mockListApps.mockResolvedValue({
      apps: [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          category: 'social',
          installed: 'installed',
        },
      ],
      isExhaustive: true,
    });
    mockPreference = { status: 'ready', selection: DEFAULT_SELECTION };
    mockRole = null;
  });

  it('defaults to solo + fixed duration', async () => {
    await renderScreen();

    expect(screen.getByTestId('create-session-type-solo')).toHaveProp('accessibilityState', {
      selected: true,
    });
    expect(screen.getByTestId('create-session-duration-fixed')).toHaveProp('accessibilityState', {
      selected: true,
    });
  });

  it('rejects submitting a fixed-duration session with no minutes entered (local validation, no request sent)', async () => {
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.minutesRequired)).toBeOnTheScreen();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('submits the solo/fixed form with the entered minutes and navigates to ActiveSession on success', async () => {
    mockCreateSession.mockResolvedValue({
      ok: true,
      value: { id: 'session-1', qrToken: null },
    });
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        blocked_categories: ['social', 'games', 'entertainment'],
        blocked_packages: [],
      }),
    );
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('ActiveSession', { sessionId: 'session-1' }),
    );
  });

  it('switches to dynamic_qr and open_ended, then submits without a minutes field at all', async () => {
    mockCreateSession.mockResolvedValue({ ok: true, value: { id: 'session-2', qrToken: 'tok' } });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-dynamic_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    expect(screen.queryByTestId('create-session-minutes-input')).toBeNull();

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'dynamic_qr',
        duration_mode: 'open_ended',
        blocked_categories: ['social', 'games', 'entertainment'],
        blocked_packages: [],
      }),
    );
  });

  it('shows a loading state while the request is in flight', async () => {
    let resolveCreate: (value: unknown) => void = () => undefined;
    mockCreateSession.mockReturnValue(new Promise((resolve) => (resolveCreate = resolve)));
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() => expect(screen.getByTestId('create-session-submit')).toBeDisabled());

    resolveCreate({ ok: true, value: { id: 'session-3', qrToken: null } });
    await waitFor(() => expect(mockNavigate).toHaveBeenCalled());
  });

  it('shows an error message and stays on the screen when the request fails', async () => {
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected', message: 'boom' },
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.requestFailed)).toBeOnTheScreen();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('never offers static_qr to a plain user', async () => {
    await renderScreen();

    expect(screen.queryByTestId('create-session-type-static_qr')).toBeNull();
  });

  it('offers static_qr to a verified host and fetches their venues once selected', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: { venues: [{ id: 'venue-1', name: "Joe's Cafe" }] },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));

    expect(await screen.findByText("Joe's Cafe")).toBeOnTheScreen();
  });

  it('requires a venue to be selected before submitting a static_qr session', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: {
        venues: [
          {
            id: 'venue-1',
            name: 'Cafe',
            approvedBlockedCategories: ['social', 'games', 'entertainment'],
            approvedBlockedPackages: [],
          },
        ],
      },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await screen.findByText('Cafe');
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.venueRequired)).toBeOnTheScreen();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  it('submits venue_id once a venue is picked', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: {
        venues: [
          {
            id: 'venue-1',
            name: 'Cafe',
            approvedBlockedCategories: ['social', 'games', 'entertainment'],
            approvedBlockedPackages: [],
          },
        ],
      },
    });
    mockCreateSession.mockResolvedValue({
      ok: true,
      value: { id: 'session-4', qrToken: null },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await fireEvent.press(await screen.findByTestId('create-session-venue-venue-1'));
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'static_qr',
        duration_mode: 'open_ended',
        venue_id: 'venue-1',
        blocked_categories: ['social', 'games', 'entertainment'],
        blocked_packages: [],
      }),
    );
  });

  it('maps venue_not_owned/venue_not_found to their own copy', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: {
        venues: [
          {
            id: 'venue-1',
            name: 'Cafe',
            approvedBlockedCategories: ['social', 'games', 'entertainment'],
            approvedBlockedPackages: [],
          },
        ],
      },
    });
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'venue_not_owned', message: 'nope' },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await fireEvent.press(screen.getByTestId('create-session-duration-open_ended'));
    await fireEvent.press(await screen.findByTestId('create-session-venue-venue-1'));
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.venueNotOwned)).toBeOnTheScreen();
  });
});

describe('CreateSessionScreen — the blocklist (Phase 9)', () => {
  beforeEach(() => {
    mockCreateSession.mockReset();
    mockListVenues.mockReset();
    mockNavigate.mockClear();
    mockRememberBlocklistPreference.mockReset();
    mockRememberBlocklistPreference.mockResolvedValue(undefined);
    mockListApps.mockReset();
    mockListApps.mockResolvedValue({
      apps: [
        {
          id: 'com.instagram.android',
          name: 'Instagram',
          category: 'social',
          installed: 'installed',
        },
      ],
      isExhaustive: true,
    });
    mockPreference = { status: 'ready', selection: DEFAULT_SELECTION };
    mockRole = null;
  });

  it('pre-fills the host last committed choice rather than starting from scratch', async () => {
    mockPreference = {
      status: 'ready',
      selection: { categories: ['news'], packages: ['com.instagram.android'] },
    };
    await renderScreen();

    await waitFor(() =>
      expect(screen.getByTestId('blocklist-category-news')).toHaveProp('accessibilityState', {
        checked: true,
      }),
    );
    expect(screen.getByTestId('blocklist-category-social')).toHaveProp('accessibilityState', {
      checked: false,
    });
  });

  it('sends what the host actually picked', async () => {
    mockCreateSession.mockResolvedValue({ ok: true, value: { id: 'session-9', qrToken: null } });
    await renderScreen();

    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');
    await pressAndSettle('blocklist-category-news', { checked: true });
    await pressAndSettle('blocklist-app-com.instagram.android', { checked: true });
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockCreateSession).toHaveBeenCalledWith({
        type: 'solo',
        duration_mode: 'fixed',
        planned_duration_minutes: 30,
        blocked_categories: ['social', 'games', 'entertainment', 'news'],
        blocked_packages: ['com.instagram.android'],
      }),
    );
  });

  // Mirrors the server's own non-empty rule. An accident-guard, not an
  // anti-abuse control: it exists so nobody creates a session that blocks
  // nothing while paying 1pt/min.
  it('refuses to submit a session that blocks nothing, without sending a request', async () => {
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    for (const category of ['social', 'games', 'entertainment']) {
      await pressAndSettle(`blocklist-category-${category}`, { checked: false });
    }
    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(await screen.findByText(en.createSession.errors.blocklistRequired)).toBeOnTheScreen();
    expect(mockCreateSession).not.toHaveBeenCalled();
  });

  // Remembered only after a create the server accepted — what gets saved is
  // a choice the host committed to, not one they were midway through
  // changing their mind about.
  it('remembers the choice only after the server accepts it', async () => {
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'unexpected', message: 'boom' },
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');
    await pressAndSettle('blocklist-category-news', { checked: true });

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await screen.findByText(en.createSession.errors.requestFailed);
    expect(mockRememberBlocklistPreference).not.toHaveBeenCalled();
  });

  it('remembers the choice once the session is created', async () => {
    mockCreateSession.mockResolvedValue({ ok: true, value: { id: 'session-9', qrToken: null } });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');
    await pressAndSettle('blocklist-category-news', { checked: true });

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    await waitFor(() =>
      expect(mockRememberBlocklistPreference).toHaveBeenCalledWith({
        categories: ['social', 'games', 'entertainment', 'news'],
        packages: [],
      }),
    );
  });

  // The picker should have made this unreachable; it arrives when the
  // client was working from a stale venue approval. The copy has to explain
  // the refusal rather than blame the network.
  it('maps the venue-approval refusal to its own copy', async () => {
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'blocklist_not_venue_approved', message: 'not approved: maps' },
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(
      await screen.findByText(en.createSession.errors.blocklistNotVenueApproved),
    ).toBeOnTheScreen();
  });

  it('maps the safety-denylist refusal to its own copy', async () => {
    mockCreateSession.mockResolvedValue({
      ok: false,
      error: { code: 'blocked_package_not_allowed', message: 'com.android.dialer' },
    });
    await renderScreen();
    await fireEvent.changeText(screen.getByTestId('create-session-minutes-input'), '30');

    await fireEvent.press(screen.getByTestId('create-session-submit'));

    expect(
      await screen.findByText(en.createSession.errors.blockedPackageNotAllowed),
    ).toBeOnTheScreen();
  });

  it('narrows the picker to a venue approved set once that venue is chosen', async () => {
    mockRole = 'verified_host';
    mockListVenues.mockResolvedValue({
      ok: true,
      value: {
        venues: [
          {
            id: 'venue-1',
            name: 'Test Venue',
            approvedBlockedCategories: ['social'],
            approvedBlockedPackages: [],
          },
        ],
      },
    });
    await renderScreen();

    await fireEvent.press(screen.getByTestId('create-session-type-static_qr'));
    await waitFor(() => expect(screen.getByTestId('create-session-venue-venue-1')).toBeOnTheScreen());
    await fireEvent.press(screen.getByTestId('create-session-venue-venue-1'));

    await waitFor(() => expect(screen.getByTestId('blocklist-venue-note')).toBeOnTheScreen());
    expect(screen.queryByTestId('blocklist-category-news')).toBeNull();
  });
});
