import React from 'react';
import { StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';

import { render, screen } from '@testing-library/react-native';

import { colors, radius, sizing } from '../theme/tokens';
import IconBadge from './IconBadge';

// The tinted circle that sits above the Screen 2 title, holding a glyph the
// way the reference design does. Kept as its own component rather than a
// style object because it owns a layout invariant (centre its child), not
// just a fill.
//
// Pinned contracts:
// - Diameter is the iconBadge token; the fill is primarySubtle (the accent at
//   ~12% over black), which is what makes the circle read as an accent
//   surface rather than a grey chip.
// - The child is centred on both axes. A glyph drifting off-centre inside a
//   circle is immediately visible and would otherwise only be caught by eye.

const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

describe('IconBadge', () => {
  it('draws a round badge at the sizing token, filled with the subtle accent', async () => {
    await render(
      <IconBadge testID="icon-badge">
        <Text>glyph</Text>
      </IconBadge>,
    );

    const badge = flattenedStyle('icon-badge');
    expect(badge.width).toBe(sizing.iconBadge);
    expect(badge.height).toBe(sizing.iconBadge);
    expect(badge.borderRadius).toBe(radius.full);
    expect(badge.backgroundColor).toBe(colors.primarySubtle);
  });

  it('centres its child on both axes', async () => {
    await render(
      <IconBadge testID="icon-badge">
        <Text>glyph</Text>
      </IconBadge>,
    );

    const badge = flattenedStyle('icon-badge');
    expect(badge.alignItems).toBe('center');
    expect(badge.justifyContent).toBe('center');
  });

  it('renders whatever glyph it is given', async () => {
    await render(
      <IconBadge testID="icon-badge">
        <Text>glyph</Text>
      </IconBadge>,
    );

    expect(screen.getByText('glyph')).toBeOnTheScreen();
  });
});
