import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';

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

import BlocklistSummary from './BlocklistSummary';

// Active Session (Screen 6)'s blocklist summary
// (docs/BLOCKLIST_SELECTION_PLAN.md §7, owner decision: full list,
// expandable). The pre-join screen is easy to forget an hour in, and
// someone who has just hit a block wants to know why.
//
// Read-only by construction: the component takes no callback and offers no
// edit affordance. The blocklist is frozen for the session's lifetime (§9a).

const renderSummary = async (
  categories: readonly string[],
  packages: readonly string[],
  locale = 'en',
): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);
  await render(
    <I18nProvider i18n={i18n}>
      <BlocklistSummary categories={categories as never} packages={packages} />
    </I18nProvider>,
  );
};

describe('BlocklistSummary', () => {
  it('shows a compact summary rather than the whole list', async () => {
    await renderSummary(['social', 'games', 'news'], ['com.waze']);

    expect(screen.getByText(en.createSession.blocklist.category.social)).toBeOnTheScreen();
    expect(screen.getByText(en.createSession.blocklist.category.games)).toBeOnTheScreen();
    expect(screen.queryByText(en.createSession.blocklist.category.news)).toBeNull();
  });

  it('says how many it is not showing', async () => {
    await renderSummary(['social', 'games', 'news'], ['com.waze']);

    expect(screen.getByTestId('active-session-blocklist-more')).toBeOnTheScreen();
  });

  it('shows everything on tap', async () => {
    await renderSummary(['social', 'games', 'news'], ['com.waze']);

    await fireEvent.press(screen.getByTestId('active-session-blocklist'));

    expect(screen.getByText(en.createSession.blocklist.category.news)).toBeOnTheScreen();
    expect(screen.getByText('Waze')).toBeOnTheScreen();
    expect(screen.queryByTestId('active-session-blocklist-more')).toBeNull();
  });

  it('collapses again on a second tap', async () => {
    await renderSummary(['social', 'games', 'news'], []);

    await fireEvent.press(screen.getByTestId('active-session-blocklist'));
    await fireEvent.press(screen.getByTestId('active-session-blocklist'));

    expect(screen.queryByText(en.createSession.blocklist.category.news)).toBeNull();
  });

  it('tells a screen reader whether it is expanded', async () => {
    await renderSummary(['social', 'games', 'news'], []);

    expect(screen.getByTestId('active-session-blocklist')).toHaveProp('accessibilityState', {
      expanded: false,
    });

    await fireEvent.press(screen.getByTestId('active-session-blocklist'));

    expect(screen.getByTestId('active-session-blocklist')).toHaveProp('accessibilityState', {
      expanded: true,
    });
  });

  it('offers no overflow affordance when everything already fits', async () => {
    await renderSummary(['social'], []);

    expect(screen.queryByTestId('active-session-blocklist-more')).toBeNull();
  });

  // Same de-duplication as Screen 8 (§9), via the shared describeBlocklist:
  // pick `social` AND Instagram and only "Social" is worth saying.
  it('does not list an app its category already covers', async () => {
    await renderSummary(['social'], ['com.instagram.android']);

    await fireEvent.press(screen.getByTestId('active-session-blocklist'));

    expect(screen.queryByText('Instagram')).toBeNull();
  });

  // The DB forbids it and the API rejects it, so this is unreachable — but
  // rendering "Blocking:" followed by nothing would be worse than rendering
  // nothing at all.
  it('renders nothing at all for an empty blocklist', async () => {
    await renderSummary([], []);

    expect(screen.queryByTestId('active-session-blocklist')).toBeNull();
  });

  it('renders its label in Hebrew while leaving app names in English', async () => {
    await renderSummary([], ['com.instagram.android'], 'he');

    expect(screen.getByText(he.activeSession.blocklist.label)).toBeOnTheScreen();
    expect(screen.getByText('Instagram')).toBeOnTheScreen();
  });
});
