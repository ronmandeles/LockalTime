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

// The two places the same app can be tapped. They are different rows on
// screen — one inside its category, one in the flat list below — and they
// must always agree, because they read and write the same selection.
const inCategory = (packageName: string): string => `blocklist-category-app-${packageName}`;
const inFlatList = (packageName: string): string => `blocklist-app-${packageName}`;

// Opening or closing a category changes the picker's OWN state, and React
// flushes that asynchronously here — unlike a tap that only calls back out
// through onChange, which lands synchronously. Every drawer press therefore
// has to be awaited, or the assertion after it reads the previous render.
const pressExpander = async (category: string, becomesOpen: boolean): Promise<void> => {
  fireEvent.press(screen.getByTestId(`blocklist-category-expand-${category}`));
  await waitFor(
    () =>
      expect(screen.getByTestId(`blocklist-category-expand-${category}`)).toHaveProp(
        'accessibilityState',
        { expanded: becomesOpen },
      ),
    // Well past the default second: the whole suite runs in parallel
    // workers, and a timeout that only trips under load is a flake, not a
    // signal (testing-standards, determinism).
    { timeout: 5000 },
  );
};

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

// Owner decision 2026-08-11: a category row expands to show the apps we can
// actually name inside it, so "Social" is not an opaque word the host has to
// take on trust. What the expansion shows is the catalog, filtered exactly
// as the flat list below is; what the category BLOCKS is whatever the
// device files under that category, which is strictly more. Those two facts
// are why the expansion carries a note rather than a bare list.
describe('the apps under a category', () => {
  it('keeps every category collapsed until it is asked to expand', async () => {
    await renderPicker({ categories: ['social'], packages: [] });

    await screen.findByText('Instagram');
    expect(screen.queryByTestId(inCategory('com.instagram.android'))).toBeNull();
  });

  it('lists that category’s apps when expanded, and no other category’s', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(screen.getByTestId(inCategory('com.instagram.android'))).toBeOnTheScreen();
    expect(screen.getByTestId(inCategory('com.zhiliaoapp.musically'))).toBeOnTheScreen();
    expect(screen.queryByTestId(inCategory('com.roblox.client'))).toBeNull();
  });

  it('marks the expander as expanded for screen readers', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    expect(screen.getByTestId('blocklist-category-expand-social')).toHaveProp(
      'accessibilityState',
      { expanded: false },
    );

    await pressExpander('social', true);

    expect(screen.getByTestId('blocklist-category-expand-social')).toHaveProp(
      'accessibilityState',
      { expanded: true },
    );
  });

  // One at a time, deliberately: Social alone is 32 rows in the real
  // catalog, and this screen does not scroll past what the picker is given.
  it('opens one category at a time', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);
    await pressExpander('games', true);

    expect(screen.getByTestId(inCategory('com.roblox.client'))).toBeOnTheScreen();
    expect(screen.queryByTestId(inCategory('com.instagram.android'))).toBeNull();
  });

  it('collapses again when the open category is tapped a second time', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);
    await pressExpander('social', false);

    expect(screen.queryByTestId(inCategory('com.instagram.android'))).toBeNull();
  });

  it('says how many apps it can name in a category', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    // Matched loosely: the assertion is about the number the host sees, not
    // about the sentence it sits in, which is copy and may be reworded.
    expect(screen.getByTestId('blocklist-category-count-social')).toHaveTextContent(/\b2\b/);
    expect(screen.getByTestId('blocklist-category-count-games')).toHaveTextContent(/\b1\b/);
  });

  // A category we can name nothing in still blocks everything the device
  // files under it — there is just no list to show, so offering an empty
  // drawer would only look broken.
  it('offers no expander for a category it can name no apps in', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    expect(screen.getByTestId('blocklist-category-expand-social')).toBeOnTheScreen();
    expect(screen.queryByTestId('blocklist-category-expand-news')).toBeNull();
  });

  // Looking at a category is not choosing it, and choosing it is not
  // looking at it. Conflating the two would make the host block something
  // by browsing, or hide the list behind a commitment.
  it('does not change the selection when a category is expanded', async () => {
    await renderPicker({ categories: [], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(onChange).not.toHaveBeenCalled();
  });

  it('does not expand when the category itself is tapped', async () => {
    await renderPicker({ categories: [], packages: [] });
    await screen.findByText('Instagram');

    fireEvent.press(screen.getByTestId('blocklist-category-social'));

    expect(onChange).toHaveBeenCalledWith({ categories: ['social'], packages: [] });
    expect(screen.queryByTestId(inCategory('com.instagram.android'))).toBeNull();
  });

  it('adds an app tapped inside its category, by package name', async () => {
    await renderPicker({ categories: ['games'], packages: [] });
    await screen.findByText('Instagram');
    await pressExpander('social', true);

    fireEvent.press(screen.getByTestId(inCategory('com.instagram.android')));

    expect(onChange).toHaveBeenCalledWith({
      categories: ['games'],
      packages: ['com.instagram.android'],
    });
  });

  it('removes an already-selected app tapped inside its category', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android', 'com.waze'] });
    await screen.findByText('Instagram');
    await pressExpander('social', true);

    fireEvent.press(screen.getByTestId(inCategory('com.instagram.android')));

    expect(onChange).toHaveBeenCalledWith({ categories: [], packages: ['com.waze'] });
  });

  it('shows the same checked state as the flat list below', async () => {
    await renderPicker({ categories: [], packages: ['com.instagram.android'] });
    await screen.findByText('Instagram');
    await pressExpander('social', true);

    expect(screen.getByTestId(inCategory('com.instagram.android'))).toHaveProp(
      'accessibilityState',
      { checked: true },
    );
    expect(screen.getByTestId(inFlatList('com.instagram.android'))).toHaveProp(
      'accessibilityState',
      { checked: true },
    );
    expect(screen.getByTestId(inCategory('com.zhiliaoapp.musically'))).toHaveProp(
      'accessibilityState',
      { checked: false },
    );
  });

  // The honesty note. The blocker matches on the device's own category, so
  // this list is what we can name, never the boundary of what gets blocked.
  it('says the list is what it can name, not the whole category', async () => {
    await renderPicker({ categories: [], packages: [] });
    await screen.findByText('Instagram');

    expect(screen.queryByText(en.createSession.blocklist.categoryAppsNote)).toBeNull();

    await pressExpander('social', true);

    expect(screen.getByText(en.createSession.blocklist.categoryAppsNote)).toBeOnTheScreen();
  });

  // Ticking Instagram under a Social session changes nothing, and the host
  // should be told that rather than left to infer it from a checkbox that
  // appears to do nothing.
  it('says the apps are already covered when the category is on', async () => {
    await renderPicker({ categories: ['social'], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(screen.getByText(en.createSession.blocklist.categoryCoveredNote)).toBeOnTheScreen();
  });

  it('says nothing about coverage when the category is off', async () => {
    await renderPicker({ categories: ['games'], packages: [] });
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(screen.queryByText(en.createSession.blocklist.categoryCoveredNote)).toBeNull();
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

  it('narrows a category’s own list to the approved apps too', async () => {
    await renderPicker({ categories: ['social'], packages: [] }, approved);
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(screen.getByTestId(inCategory('com.instagram.android'))).toBeOnTheScreen();
    expect(screen.queryByTestId(inCategory('com.zhiliaoapp.musically'))).toBeNull();
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

  it('renders the expanded category’s copy in Hebrew', async () => {
    await renderPicker({ categories: [], packages: [] }, null, 'he');
    await screen.findByText('Instagram');

    await pressExpander('social', true);

    expect(screen.getByText(he.createSession.blocklist.categoryAppsNote)).toBeOnTheScreen();
  });
});
