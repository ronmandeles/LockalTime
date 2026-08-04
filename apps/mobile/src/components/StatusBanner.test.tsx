import React from 'react';

import { fireEvent, render, screen } from '@testing-library/react-native';

import StatusBanner from './StatusBanner';

describe('StatusBanner', () => {
  it('renders the message', async () => {
    await render(<StatusBanner message="You are offline" testID="banner" />);

    expect(screen.getByText('You are offline')).toBeOnTheScreen();
  });

  it('renders no action when none is provided', async () => {
    await render(<StatusBanner message="Reconnecting…" testID="banner" />);

    expect(screen.queryByTestId('banner-action')).toBeNull();
  });

  it('renders and fires an action when both actionLabel and onAction are provided', async () => {
    const onAction = jest.fn();
    await render(
      <StatusBanner
        message="Blocked"
        actionLabel="Open Settings"
        onAction={onAction}
        testID="banner"
      />,
    );

    fireEvent.press(screen.getByTestId('banner-action'));

    expect(onAction).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Open Settings')).toBeOnTheScreen();
  });

  it('never renders an action when only one of actionLabel/onAction is provided', async () => {
    await render(<StatusBanner message="Blocked" actionLabel="Open Settings" testID="banner" />);

    expect(screen.queryByTestId('banner-action')).toBeNull();
  });
});
