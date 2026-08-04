import React from 'react';

import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

const mockListFriends = jest.fn();
const mockListFriendRequests = jest.fn();
const mockSearchUsers = jest.fn();
const mockSendFriendRequest = jest.fn();
const mockRespondToFriendRequest = jest.fn();
jest.mock('../services/api-client', () => ({
  listFriends: () => mockListFriends(),
  listFriendRequests: () => mockListFriendRequests(),
  searchUsers: (...args: unknown[]) => mockSearchUsers(...args),
  sendFriendRequest: (...args: unknown[]) => mockSendFriendRequest(...args),
  respondToFriendRequest: (...args: unknown[]) => mockRespondToFriendRequest(...args),
}));

const mockRemoveFriend = jest.fn();
jest.mock('../services/friends-repository', () => ({
  removeFriend: (...args: unknown[]) => mockRemoveFriend(...args),
}));

jest.mock('../state/auth-store', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      auth: {
        status: 'authenticated',
        session: { user: { id: 'user-1' } },
      },
    }),
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
import FriendsScreen from './FriendsScreen';

const navigationStub = {} as unknown as Parameters<typeof FriendsScreen>[0]['navigation'];
const routeStub = { key: 'Friends', name: 'Friends' as const, params: undefined };

const SELF_ENTRY = {
  id: 'user-1',
  username: 'me',
  displayName: 'Me',
  avatarUrl: null,
  totalPoints: 100,
  hadSessionToday: false,
  isSelf: true,
};
const FRIEND_ENTRY = {
  id: 'user-2',
  username: 'bob',
  displayName: 'Bob Levi',
  avatarUrl: null,
  totalPoints: 250,
  hadSessionToday: true,
  isSelf: false,
};

const renderScreen = async (): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage('en');
  await render(
    <I18nProvider i18n={i18n}>
      <FriendsScreen navigation={navigationStub} route={routeStub} />
    </I18nProvider>,
  );
};

describe('FriendsScreen', () => {
  beforeEach(() => {
    mockListFriends.mockReset();
    mockListFriendRequests.mockReset();
    mockSearchUsers.mockReset();
    mockSendFriendRequest.mockReset();
    mockRespondToFriendRequest.mockReset();
    mockRemoveFriend.mockReset();
    mockListFriendRequests.mockResolvedValue({ ok: true, value: { incoming: [], outgoing: [] } });
  });

  it('shows an empty state for a user with no friends yet', async () => {
    mockListFriends.mockResolvedValue({ ok: true, value: { leaderboard: [SELF_ENTRY] } });

    await renderScreen();

    expect(await screen.findByText(en.friends.emptyLeaderboard)).toBeOnTheScreen();
  });

  it('renders the leaderboard with points and an active-today indicator, ranked as returned', async () => {
    mockListFriends.mockResolvedValue({
      ok: true,
      value: { leaderboard: [FRIEND_ENTRY, SELF_ENTRY] },
    });

    await renderScreen();

    expect(await screen.findByText('Bob Levi')).toBeOnTheScreen();
    expect(screen.getByText(en.friends.pointsLabel.replace('{{count}}', '250'))).toBeOnTheScreen();
    expect(screen.getByText(en.friends.activeToday)).toBeOnTheScreen();
    expect(screen.getByText(en.friends.you)).toBeOnTheScreen();
  });

  it('shows a retry affordance when the leaderboard fails to load', async () => {
    mockListFriends.mockResolvedValue({ ok: false, error: { message: 'network error' } });

    await renderScreen();

    expect(await screen.findByText(en.friends.loadError)).toBeOnTheScreen();
    expect(screen.getByTestId('friends-retry')).toBeOnTheScreen();
  });

  it('rejects a search query shorter than 2 characters locally, without a request', async () => {
    mockListFriends.mockResolvedValue({ ok: true, value: { leaderboard: [SELF_ENTRY] } });
    await renderScreen();
    await screen.findByText(en.friends.emptyLeaderboard);

    await fireEvent.changeText(screen.getByTestId('friends-search-input'), 'a');
    await fireEvent.press(screen.getByTestId('friends-search-submit'));

    expect(await screen.findByText(en.friends.search.tooShort)).toBeOnTheScreen();
    expect(mockSearchUsers).not.toHaveBeenCalled();
  });

  it('searches and sends a friend request from a result', async () => {
    mockListFriends.mockResolvedValue({ ok: true, value: { leaderboard: [SELF_ENTRY] } });
    mockSearchUsers.mockResolvedValue({
      ok: true,
      value: {
        results: [
          {
            id: 'user-3',
            username: 'carol',
            displayName: 'Carol',
            avatarUrl: null,
            relationship: 'none',
          },
        ],
      },
    });
    mockSendFriendRequest.mockResolvedValue({ ok: true, value: { status: 'requested' } });
    await renderScreen();
    await screen.findByText(en.friends.emptyLeaderboard);

    await fireEvent.changeText(screen.getByTestId('friends-search-input'), 'carol');
    await fireEvent.press(screen.getByTestId('friends-search-submit'));
    await screen.findByText('Carol');

    await fireEvent.press(screen.getByTestId('friends-search-add-user-3'));

    await waitFor(() => expect(mockSendFriendRequest).toHaveBeenCalledWith('user-3'));
  });

  it('shows an incoming request with accept/decline, reloading the leaderboard on accept', async () => {
    mockListFriends.mockResolvedValueOnce({ ok: true, value: { leaderboard: [SELF_ENTRY] } });
    mockListFriendRequests.mockResolvedValue({
      ok: true,
      value: {
        incoming: [
          {
            id: 'req-1',
            userId: 'user-2',
            username: 'bob',
            displayName: 'Bob Levi',
            avatarUrl: null,
            createdAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        outgoing: [],
      },
    });
    mockRespondToFriendRequest.mockResolvedValue({ ok: true, value: { status: 'accepted' } });
    mockListFriends.mockResolvedValueOnce({
      ok: true,
      value: { leaderboard: [FRIEND_ENTRY, SELF_ENTRY] },
    });

    await renderScreen();
    await screen.findByText('Bob Levi');

    await fireEvent.press(screen.getByTestId('friends-request-accept-req-1'));

    await waitFor(() => expect(mockRespondToFriendRequest).toHaveBeenCalledWith('req-1', true));
    await waitFor(() => expect(mockListFriends).toHaveBeenCalledTimes(2));
  });

  it('requires an explicit confirmation before removing a friend', async () => {
    mockListFriends.mockResolvedValue({
      ok: true,
      value: { leaderboard: [FRIEND_ENTRY, SELF_ENTRY] },
    });

    await renderScreen();
    await screen.findByText('Bob Levi');

    await fireEvent.press(screen.getByTestId('friends-remove-user-2'));

    expect(screen.getByText(en.friends.remove.confirmTitle)).toBeOnTheScreen();
    expect(mockRemoveFriend).not.toHaveBeenCalled();
  });

  it('removes a friend once confirmed and reloads the leaderboard', async () => {
    mockListFriends.mockResolvedValueOnce({
      ok: true,
      value: { leaderboard: [FRIEND_ENTRY, SELF_ENTRY] },
    });
    mockRemoveFriend.mockResolvedValue({ ok: true, value: null });
    mockListFriends.mockResolvedValueOnce({ ok: true, value: { leaderboard: [SELF_ENTRY] } });

    await renderScreen();
    await screen.findByText('Bob Levi');

    await fireEvent.press(screen.getByTestId('friends-remove-user-2'));
    await fireEvent.press(screen.getByTestId('friends-remove-confirm-user-2'));

    await waitFor(() => expect(mockRemoveFriend).toHaveBeenCalledWith('user-1', 'user-2'));
    await waitFor(() => expect(screen.queryByText('Bob Levi')).not.toBeOnTheScreen());
  });
});
