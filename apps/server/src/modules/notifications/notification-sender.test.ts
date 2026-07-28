import { unconfiguredNotificationSender } from './notification-sender';

describe('unconfiguredNotificationSender', () => {
  it('reports not_configured for every send request rather than fabricating delivery', async () => {
    const result = await unconfiguredNotificationSender.send({
      platform: 'android',
      token: 'device-token-abc',
      title: 'Your streak is at risk',
      body: 'Start a session today to keep it going.',
    });

    expect(result).toEqual({ status: 'not_configured' });
  });

  it('behaves identically for ios requests — the placeholder never branches on platform', async () => {
    const result = await unconfiguredNotificationSender.send({
      platform: 'ios',
      token: 'device-token-xyz',
      title: 'Your streak is at risk',
      body: 'Start a session today to keep it going.',
    });

    expect(result).toEqual({ status: 'not_configured' });
  });
});
