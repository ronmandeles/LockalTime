import React from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';

import { render, screen } from '@testing-library/react-native';

import { colors, radius, sizing } from '../theme/tokens';
import LogoMark from './LogoMark';

// The Lockal Time ring mark, drawn with plain Views rather than an SVG or an
// icon font: there is no icon library in this app, and adding one (the only
// candidate being react-native-svg) would be the single native-linking risk
// in an otherwise JS-only theme change. Two Views cost nothing and stay
// exact at any size.
//
// Pinned contracts:
// - Geometry is PROPORTIONAL, measured off the real 1024px app icon:
//   stroke = size x 0.0964, inner dot = size x 0.4217. Hardcoding pixel
//   values for one size would silently distort the mark at the other, and
//   the component is deliberately used at two very different sizes (the
//   Screen 1 hero at 160, and roughly half the badge diameter on Screen 2).
// - Both circles are round via radius.full, never an arithmetic size / 2.
// - `color` tints the ring and the dot together — the mark is monochrome, so
//   one prop drives both. Screen 1 renders it in textPrimary, Screen 2 in
//   primary inside the tinted badge.

const RING_STROKE_RATIO = 0.0964;
const INNER_DOT_RATIO = 0.4217;

const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

const asNumber = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new Error(`expected a numeric style value, got: ${String(value)}`);
  }
  return value;
};

describe('LogoMark', () => {
  it('defaults to the hero-logo sizing token so Screen 1 never restates the number', async () => {
    await render(<LogoMark />);

    const ring = flattenedStyle('logo-mark');
    expect(ring.width).toBe(sizing.heroLogo);
    expect(ring.height).toBe(sizing.heroLogo);
  });

  it('renders a perfectly round ring at the requested size', async () => {
    await render(<LogoMark size={200} />);

    const ring = flattenedStyle('logo-mark');
    expect(ring.width).toBe(200);
    expect(ring.height).toBe(200);
    expect(ring.borderRadius).toBe(radius.full);
  });

  it.each([48, 100, 160, 200])(
    'scales the ring stroke and inner dot proportionally at size %i',
    async (size) => {
      await render(<LogoMark size={size} />);

      expect(asNumber(flattenedStyle('logo-mark').borderWidth)).toBe(
        Math.round(size * RING_STROKE_RATIO),
      );

      const dot = flattenedStyle('logo-mark-dot');
      const expectedDot = Math.round(size * INNER_DOT_RATIO);
      expect(dot.width).toBe(expectedDot);
      expect(dot.height).toBe(expectedDot);
      expect(dot.borderRadius).toBe(radius.full);
    },
  );

  it('tints the ring and the dot with one color, defaulting to primary text', async () => {
    await render(<LogoMark />);

    expect(flattenedStyle('logo-mark').borderColor).toBe(colors.textPrimary);
    expect(flattenedStyle('logo-mark-dot').backgroundColor).toBe(colors.textPrimary);
  });

  it('applies an explicit color to both the ring and the dot', async () => {
    await render(<LogoMark color={colors.primary} />);

    expect(flattenedStyle('logo-mark').borderColor).toBe(colors.primary);
    expect(flattenedStyle('logo-mark-dot').backgroundColor).toBe(colors.primary);
  });

  it('accepts a caller testID so two marks on one screen stay distinguishable', async () => {
    await render(<LogoMark testID="permission-badge-mark" />);

    expect(screen.getByTestId('permission-badge-mark')).toBeOnTheScreen();
    expect(screen.queryByTestId('logo-mark')).toBeNull();
  });
});
