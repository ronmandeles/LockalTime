// session-channel.ts wires the three Supabase Realtime primitives together
// per ARCHITECTURE.md §5. Presence/Broadcast are UI-hint only — this suite
// pins that the module is a pure pass-through for them (it never
// interprets or mutates anything based on a Broadcast payload), and that
// Postgres Changes handlers are wired for the two tables that carry
// trusted state (sessions, session_presence_intervals).

const mockChannel = {
  on: jest.fn(),
  subscribe: jest.fn(),
  track: jest.fn(async () => undefined),
  presenceState: jest.fn(() => ({ 'user-1': [{ user_id: 'user-1' }] })),
};
const mockClient = {
  channel: jest.fn(() => mockChannel),
  removeChannel: jest.fn(async () => undefined),
};

jest.mock('./supabase-client', () => ({
  getSupabaseClient: () => mockClient,
}));

import { sessionChannelName, subscribeToSessionChannel } from './session-channel';

const SESSION_ID = '77777777-7777-7777-7777-777777777777';

describe('sessionChannelName', () => {
  it('names the channel session:{session_id} per ARCHITECTURE.md §5', () => {
    expect(sessionChannelName(SESSION_ID)).toBe(`session:${SESSION_ID}`);
  });
});

describe('subscribeToSessionChannel', () => {
  beforeEach(() => {
    mockChannel.on.mockClear();
    mockChannel.subscribe.mockClear();
    mockChannel.track.mockClear();
    mockClient.channel.mockClear();
    mockClient.removeChannel.mockClear();
  });

  it('opens exactly one channel named for the session', () => {
    subscribeToSessionChannel(SESSION_ID, {});

    expect(mockClient.channel).toHaveBeenCalledTimes(1);
    expect(mockClient.channel).toHaveBeenCalledWith(`session:${SESSION_ID}`);
  });

  it('subscribes the channel', () => {
    subscribeToSessionChannel(SESSION_ID, {});

    expect(mockChannel.subscribe).toHaveBeenCalledTimes(1);
  });

  it('forwards a presence sync event to onPresenceSync with the raw presence state', () => {
    const onPresenceSync = jest.fn();
    subscribeToSessionChannel(SESSION_ID, { onPresenceSync });

    const presenceHandler = mockChannel.on.mock.calls.find(([type, filter]) => type === 'presence' && filter.event === 'sync')?.[2];
    presenceHandler();

    expect(onPresenceSync).toHaveBeenCalledWith(mockChannel.presenceState());
  });

  it('forwards each known broadcast event to onBroadcast as a pure pass-through (UI-hint only)', () => {
    const onBroadcast = jest.fn();
    subscribeToSessionChannel(SESSION_ID, { onBroadcast });

    const sessionEndedHandler = mockChannel.on.mock.calls.find(
      ([type, filter]) => type === 'broadcast' && filter.event === 'session_ended',
    )?.[2];
    sessionEndedHandler({ payload: { reason: 'host_ended' } });

    // The module itself does nothing with this beyond forwarding it — no
    // trusted state lives in session-channel.ts for a Broadcast to mutate.
    expect(onBroadcast).toHaveBeenCalledWith('session_ended', { reason: 'host_ended' });
  });

  it('wires a filtered postgres_changes handler for the sessions table', () => {
    const onSessionRowChange = jest.fn();
    subscribeToSessionChannel(SESSION_ID, { onSessionRowChange });

    const call = mockChannel.on.mock.calls.find(
      ([type, filter]) => type === 'postgres_changes' && filter.table === 'sessions',
    );
    expect(call?.[1]).toMatchObject({ schema: 'public', table: 'sessions', filter: `id=eq.${SESSION_ID}` });

    call?.[2]({ new: { id: SESSION_ID, status: 'active' } });
    expect(onSessionRowChange).toHaveBeenCalledWith({ new: { id: SESSION_ID, status: 'active' } });
  });

  it('wires a filtered postgres_changes handler for session_presence_intervals', () => {
    const onPresenceIntervalChange = jest.fn();
    subscribeToSessionChannel(SESSION_ID, { onPresenceIntervalChange });

    const call = mockChannel.on.mock.calls.find(
      ([type, filter]) => type === 'postgres_changes' && filter.table === 'session_presence_intervals',
    );
    expect(call?.[1]).toMatchObject({
      schema: 'public',
      table: 'session_presence_intervals',
      filter: `session_id=eq.${SESSION_ID}`,
    });
  });

  it('trackPresence tracks the given user as present', async () => {
    const handle = subscribeToSessionChannel(SESSION_ID, {});

    await handle.trackPresence({ userId: 'user-1', isHost: true });

    expect(mockChannel.track).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', is_host: true }),
    );
  });

  it('unsubscribe removes the channel — no listener leaks on unmount', async () => {
    const handle = subscribeToSessionChannel(SESSION_ID, {});

    await handle.unsubscribe();

    expect(mockClient.removeChannel).toHaveBeenCalledWith(mockChannel);
  });

  describe('onConnectionStateChange', () => {
    it('reports connected once the channel subscribes successfully', () => {
      const onConnectionStateChange = jest.fn();
      subscribeToSessionChannel(SESSION_ID, { onConnectionStateChange });

      const statusCallback = mockChannel.subscribe.mock.calls[0]?.[0];
      statusCallback('SUBSCRIBED');

      expect(onConnectionStateChange).toHaveBeenCalledWith('connected');
    });

    it.each(['CHANNEL_ERROR', 'TIMED_OUT', 'CLOSED'])(
      'reports disconnected on %s',
      (status) => {
        const onConnectionStateChange = jest.fn();
        subscribeToSessionChannel(SESSION_ID, { onConnectionStateChange });

        const statusCallback = mockChannel.subscribe.mock.calls[0]?.[0];
        statusCallback(status);

        expect(onConnectionStateChange).toHaveBeenCalledWith('disconnected');
      },
    );

    it('reports connected again on a later resubscribe (auto-reconnect)', () => {
      const onConnectionStateChange = jest.fn();
      subscribeToSessionChannel(SESSION_ID, { onConnectionStateChange });

      const statusCallback = mockChannel.subscribe.mock.calls[0]?.[0];
      statusCallback('TIMED_OUT');
      statusCallback('SUBSCRIBED');

      expect(onConnectionStateChange).toHaveBeenNthCalledWith(1, 'disconnected');
      expect(onConnectionStateChange).toHaveBeenNthCalledWith(2, 'connected');
    });
  });
});
