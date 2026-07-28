import express from 'express';
import request from 'supertest';

import { errorHandler } from '../../middleware/error-handler';
import { createRequireAuth } from '../../middleware/require-auth';
import { createTestJwks, type TestJwks } from '../../test-support/local-jwks';
import { createFriendsRouter } from './friends.router';
import type {
  FriendLeaderboardEntry,
  FriendsStore,
  PendingFriendRequestsList,
  RespondToFriendRequestOutcome,
  SendFriendRequestOutcome,
  UserSearchResult,
} from './friends-store';

let jwks: TestJwks;

beforeAll(async () => {
  jwks = await createTestJwks();
});

const buildFakeFriendsStore = (overrides?: Partial<FriendsStore>): FriendsStore => ({
  async searchUsers(): Promise<ReadonlyArray<UserSearchResult>> {
    return [];
  },
  async listPendingRequests(): Promise<PendingFriendRequestsList> {
    return { incoming: [], outgoing: [] };
  },
  async sendFriendRequest(): Promise<SendFriendRequestOutcome> {
    return 'requested';
  },
  async respondToFriendRequest(): Promise<RespondToFriendRequestOutcome> {
    return 'accepted';
  },
  async listFriends(): Promise<ReadonlyArray<FriendLeaderboardEntry>> {
    return [];
  },
  ...overrides,
});

const buildApp = (store: FriendsStore): express.Express => {
  const app = express();
  app.use(express.json());
  app.use(
    '/friends',
    createFriendsRouter({
      store,
      requireAuth: createRequireAuth(jwks.getKey),
    }),
  );
  app.use(errorHandler);
  return app;
};

describe('GET /friends', () => {
  it('returns the pre-sorted leaderboard from the store as-is', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const leaderboard: FriendLeaderboardEntry[] = [
      {
        id: 'user-2',
        username: 'bob',
        displayName: 'Bob Levi',
        avatarUrl: null,
        totalPoints: 500,
        hadSessionToday: true,
        isSelf: false,
      },
      {
        id: 'caller-1',
        username: 'me',
        displayName: 'Me',
        avatarUrl: null,
        totalPoints: 100,
        hadSessionToday: false,
        isSelf: true,
      },
    ];
    const store = buildFakeFriendsStore({
      async listFriends(userId) {
        expect(userId).toBe('caller-1');
        return leaderboard;
      },
    });

    const response = await request(buildApp(store))
      .get('/friends')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ leaderboard });
  });

  it('requires authentication', async () => {
    const store = buildFakeFriendsStore();

    const response = await request(buildApp(store)).get('/friends');

    expect(response.status).toBe(401);
  });
});

describe('GET /friends/search', () => {
  it('returns matching users with their relationship state', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const results: UserSearchResult[] = [
      {
        id: 'user-2',
        username: 'alice',
        displayName: 'Alice Cohen',
        avatarUrl: null,
        relationship: 'none',
      },
    ];
    const store = buildFakeFriendsStore({
      async searchUsers(callerId, query) {
        expect(callerId).toBe('caller-1');
        expect(query).toBe('ali');
        return results;
      },
    });

    const response = await request(buildApp(store))
      .get('/friends/search?q=ali')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ results });
  });

  it('rejects a query shorter than 2 characters — enumeration mitigation, not a UX nicety', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore();

    const response = await request(buildApp(store))
      .get('/friends/search?q=a')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('query_too_short');
  });

  it('requires authentication', async () => {
    const store = buildFakeFriendsStore();

    const response = await request(buildApp(store)).get('/friends/search?q=ali');

    expect(response.status).toBe(401);
  });
});

describe('GET /friends/requests', () => {
  it("returns the caller's incoming and outgoing pending requests", async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const pending = {
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
    };
    const store = buildFakeFriendsStore({
      async listPendingRequests(userId) {
        expect(userId).toBe('caller-1');
        return pending;
      },
    });

    const response = await request(buildApp(store))
      .get('/friends/requests')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual(pending);
  });
});

describe('POST /friends/requests', () => {
  it('sends a friend request, deriving requesterId from the token, never the body', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    let capturedRequesterId: string | undefined;
    let capturedRecipientId: string | undefined;
    const store = buildFakeFriendsStore({
      async sendFriendRequest(requesterId, recipientId) {
        capturedRequesterId = requesterId;
        capturedRecipientId = recipientId;
        return 'requested';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: 'user-2', requesterId: 'someone-else' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'requested' });
    expect(capturedRequesterId).toBe('caller-1');
    expect(capturedRecipientId).toBe('user-2');
  });

  it('reports a mutual double-request as an immediate friendship', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore({
      async sendFriendRequest() {
        return 'friends';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: 'user-2' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'friends' });
  });

  it('rejects a self-request as a client error', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore({
      async sendFriendRequest() {
        return 'invalid_recipient';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({ recipientId: 'caller-1' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('invalid_recipient');
  });

  it('rejects a missing recipientId', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore();

    const response = await request(buildApp(store))
      .post('/friends/requests')
      .set('Authorization', `Bearer ${token}`)
      .send({});

    expect(response.status).toBe(400);
  });
});

describe('POST /friends/requests/:id/respond', () => {
  it('accepts a request, deriving recipientId from the token', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    let capturedRecipientId: string | undefined;
    let capturedRequestId: string | undefined;
    let capturedAccept: boolean | undefined;
    const store = buildFakeFriendsStore({
      async respondToFriendRequest(recipientId, requestId, accept) {
        capturedRecipientId = recipientId;
        capturedRequestId = requestId;
        capturedAccept = accept;
        return 'accepted';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests/req-1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ accept: true });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'accepted' });
    expect(capturedRecipientId).toBe('caller-1');
    expect(capturedRequestId).toBe('req-1');
    expect(capturedAccept).toBe(true);
  });

  it('declines a request', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore({
      async respondToFriendRequest() {
        return 'declined';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests/req-1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ accept: false });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: 'declined' });
  });

  it('404s when the caller is not the recipient of the request', async () => {
    const token = await jwks.mintToken({ sub: 'caller-1' });
    const store = buildFakeFriendsStore({
      async respondToFriendRequest() {
        return 'not_found';
      },
    });

    const response = await request(buildApp(store))
      .post('/friends/requests/req-1/respond')
      .set('Authorization', `Bearer ${token}`)
      .send({ accept: true });

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('request_not_found');
  });
});
