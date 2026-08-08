import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import type { BlockableApp } from '../services/blockable-app-source';
import type { BlocklistSelection } from '../state/blocklist-preference-store';

// The Create Session blocklist picker (docs/BLOCKLIST_SELECTION_PLAN.md §7).
// The app source is mocked so the list is deterministic — the real one is a
// catalog of 87 apps or a live device enumeration, neither of which a
// component test should depend on.

const mockListApps = jest.fn<Promise<readonly BlockableApp[]>, []>();
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
jest.mock('react-native-localize', () => ({ getLocales: () => [EN_US] }));

import BlocklistPicker from './BlocklistPicker';

const LISTING: readonly BlockableApp[] = [
  { id: 'com.instagram.android', name: 'Instagram', category: 'social', installed: 'installed' },
  { id: 'com.zhiliaoapp.musically', name: 'TikTok', category: 'social', installed: 'installed' },
  { id: 'com.roblox.client', name: 'Roblox', category: 'games', installed: 'not_installed' },
];

const onChange = jest.fn();

const renderPicker = async (
  selection: BlocklistSelection,
  approved: BlocklistSelection | null = null,
  locale = 'en',
): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);
  render(
    <I18nProvider i18n={i18n}>
      <BlocklistPicker selection={selection} onChange={onChange} approved={approved} />
    </I18nProvider>,
  );
  await waitFor(() => expect(mockListApps).toHaveBeenCalled());
};

beforeEach(() => {
  mockListApps.mockReset();
  mockListApps.mockResolvedValue(LISTING);
  onChange.mockReset();
});

describe('the category toggles', () => {
  it('offers all six categories', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android'] });

    ['social', 'games', 'entertainment', 'news', 'maps', 'productivity'].forEach((category) => {
      expect(screen.getByTestId(`blocklist-category-${category}`)).toBeOnTheScreen();
    });
  });

  it('marks a selected category as a checked checkbox for screen readers', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    expect(screen.getByTestId('blocklist-category-social')).toHaveProp('accessibilityState', {
      checked: true,
    });
    expect(screen.getByTestId('blocklist-category-news')).toHaveProp('accessibilityState', {
      checked: false,
    });
  });

  it('adds a category on tap', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    fireEvent.press(screen.getByTestId('blocklist-category-news'));

    expect(onChange).toHaveBeenCalledWith({ categories: ['social', 'news'], packages: [] });
  });

  it('removes an already-selected category on tap', async () => {
    await renderPicker({ categories: ['social', 'news'], packages: [] });

    fireEvent.press(screen.getByTestId('blocklist-category-social'));

    expect(onChange).toHaveBeenCalledWith({ categories: ['news'], packages: [] });
  });

  // Plan §1: a category automatically covers apps installed later; a named
  // app list does not. Neither is wrong, but the host should be told so the
  // choice is deliberate rather than accidental.
  it('explains that categories cover apps installed later and a named list does not', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    expect(screen.getByText(en.createSession.blocklist.categoriesNote)).toBeOnTheScreen();
  });

  // Plan §1: maps earns a light note rather than a denylist entry —
  // blocking navigation is inconvenient but not emergency-critical the way
  // the dialer is, and the emergency exit always works.
  it('warns about navigation when maps is selected', async () => {
    await renderPicker({ categories: ['maps'], packages: [] });

    expect(screen.getByText(en.createSession.blocklist.mapsNote)).toBeOnTheScreen();
  });

  it('says nothing about navigation when maps is not selected', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    expect(screen.queryByText(en.createSession.blocklist.mapsNote)).toBeNull();
  });
});

describe('the app list', () => {
  it('lists what the source returned', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    expect(await screen.findByText('Instagram')).toBeOnTheScreen();
    expect(screen.getByText('TikTok')).toBeOnTheScreen();
  });

  it('marks a selected app as a checked checkbox for screen readers', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android'] });

    expect(
      await screen.findByTestId('blocklist-app-com.instagram.android'),
    ).toHaveProp('accessibilityState', { checked: true });
    expect(screen.getByTestId('blocklist-app-com.zhiliaoapp.musically')).toHaveProp(
      'accessibilityState',
      { checked: false },
    );
  });

  it('adds an app on tap, by package name', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    fireEvent.press(await screen.findByTestId('blocklist-app-com.instagram.android'));

    expect(onChange).toHaveBeenCalledWith({
      categories: ['social'],
      packages: ['com.instagram.android'],
    });
  });

  it('removes an already-selected app on tap', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android', 'com.waze'] });

    fireEvent.press(await screen.findByTestId('blocklist-app-com.instagram.android'));

    expect(onChange).toHaveBeenCalledWith({ categories: [], packages: ['com.waze'] });
  });

  it('shows a loading state until the source answers', async () => {
    mockListApps.mockReturnValue(new Promise(() => undefined));

    await renderPicker({ categories: ['social'], packages: [] });

    expect(screen.getByText(en.createSession.blocklist.appsLoading)).toBeOnTheScreen();
  });
});

// Plan §7, owner decision: a quiet note, not a warning. Harmless either
// way — an app the host lacks is a no-op for them and still blocks
// correctly for members who have it.
describe('the "not on this device" note', () => {
  it('counts selected apps the device is known not to have', async () => {
    await renderPicker({ categories: [], packages: ['com.roblox.client'] });

    expect(await screen.findByTestId('blocklist-not-installed-note')).toBeOnTheScreen();
  });

  it('says nothing when every selected app is present', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android'] });

    await screen.findByText('Instagram');
    expect(screen.queryByTestId('blocklist-not-installed-note')).toBeNull();
  });

  // iOS can only probe the ~50 declared schemes, so for anything else its
  // silence proves nothing. Reporting 'unknown' as absence would tell the
  // host something false about their own phone.
  it('stays silent for an app whose presence could not be determined', async () => {
    mockListApps.mockResolvedValue([
      { id: 'com.some.app', name: 'Some App', category: 'social', installed: 'unknown' },
    ]);

    await renderPicker({ categories: [], packages: ['com.some.app'] });

    await screen.findByText('Some App');
    expect(screen.queryByTestId('blocklist-not-installed-note')).toBeNull();
  });
});

// A selection carried over from a previous session that the source no
// longer offers. It must stay visible and de-selectable: an invisible
// selection that still gets submitted is the worse outcome.
describe('a carried-over selection the source does not offer', () => {
  it('still lists it so it can be turned off', async () => {
    await renderPicker({ categories: [], packages: ['com.gone.app'] });

    expect(await screen.findByTestId('blocklist-app-com.gone.app')).toHaveProp(
      'accessibilityState',
      { checked: true },
    );
  });

  // Never counted as absent. The catalog is the queryable set on BOTH
  // platforms now, so an entry outside it cannot be asked about at all — its
  // absence here means "we have never heard of this app", which is not a
  // statement about the host's phone.
  it('does NOT count it as absent, since the catalog is partial by design', async () => {
    mockListApps.mockResolvedValue(LISTING);

    await renderPicker({ categories: [], packages: ['com.gone.app'] });

    await screen.findByText('Instagram');
    expect(screen.queryByTestId('blocklist-not-installed-note')).toBeNull();
  });
});

// Plan §3/§7: a static_qr session's blocklist must fall inside its venue's
// out-of-band-approved set. Narrowing the picker is the courteous half; the
// server rejecting anything else is the half that actually holds.
describe('a venue-approved blocklist', () => {
  const approved: BlocklistSelection = {
    categories: ['social'],
    packages: ['com.instagram.android'],
  };

  it('offers only the approved categories', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, approved);

    expect(screen.getByTestId('blocklist-category-social')).toBeOnTheScreen();
    expect(screen.queryByTestId('blocklist-category-news')).toBeNull();
  });

  it('offers only the approved apps', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, approved);

    expect(await screen.findByText('Instagram')).toBeOnTheScreen();
    expect(screen.queryByText('TikTok')).toBeNull();
  });

  it('explains why the list is shorter rather than silently showing less', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, approved);

    expect(screen.getByText(en.createSession.blocklist.venueNote)).toBeOnTheScreen();
  });

  it('says nothing about venues when there is no approved set', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    expect(screen.queryByText(en.createSession.blocklist.venueNote)).toBeNull();
  });
});

describe('i18n', () => {
  it('renders its own copy in Hebrew', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, null, 'he');

    expect(screen.getByText(he.createSession.blocklist.categoriesLabel)).toBeOnTheScreen();
  });

  // Plan §6: brands are not localized, so app names stay English inside a
  // Hebrew UI. Each sits in its own Text node rather than interpolated into
  // a sentence, so the bidi algorithm cannot reorder punctuation around it
  // (i18n skill).
  it('leaves app names in English under a Hebrew locale', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, null, 'he');

    expect(await screen.findByText('Instagram')).toBeOnTheScreen();
  });
});
