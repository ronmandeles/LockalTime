import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { colors, radius, sizing, typography } from '../theme/tokens';
import GradientButton from './GradientButton';

// The primary CTA shared by the whole onboarding flow (Screens 1-3). Extracted
// rather than repeated per screen for one concrete reason: the gradient is a
// four-line style literal, and three copies of it is three places for the two
// stops to drift apart. It also keeps the "no ad-hoc style values" rule
// honest — the gradient is declared against tokens in exactly one file.
//
// The gradient itself uses React Native's built-in CSS-gradient support
// (`experimental_backgroundImage`), NOT a native module: the app needs no
// Podfile or Gradle change for one button, and the iOS build job stays
// untouched. The `experimental_` prefix is the accepted cost — if a future RN
// upgrade renames it, it is renamed in this file alone, and this test says so.
//
// Pinned contracts:
// - Height/radius come from the sizing and radius tokens.
// - Both gradient stops are the palette's gradient tokens, in order.
// - The label is bodyStrong in onPrimary — the palette guarantees that pairing
//   clears WCAG AA against both stops (tokens.test.ts).
// - Direction is 'to right' UNCONDITIONALLY. It does not mirror under RTL —
//   a gradient is a paint instruction, not layout, so RN will not flip it —
//   and branching styling on locale is forbidden. The visual effect is subtle;
//   it is a manual-QA item, not a code branch.

const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

const gradientOf = (
  testID: string,
): { type: string; direction?: string | undefined } & {
  colorStops: ReadonlyArray<{ color: unknown }>;
} => {
  const { experimental_backgroundImage: backgroundImage } = flattenedStyle(testID);
  if (!Array.isArray(backgroundImage) || backgroundImage.length !== 1) {
    throw new Error(`expected exactly one background-image layer, got: ${String(backgroundImage)}`);
  }
  return backgroundImage[0];
};

describe('GradientButton', () => {
  it('sizes itself to the button-height and large-radius tokens', async () => {
    await render(<GradientButton label="Get Started" onPress={jest.fn()} testID="cta" />);

    const style = flattenedStyle('cta');
    expect(style.height).toBe(sizing.buttonHeight);
    expect(style.borderRadius).toBe(radius.lg);
  });

  it('paints a left-to-right linear gradient between the two accent stops', async () => {
    await render(<GradientButton label="Get Started" onPress={jest.fn()} testID="cta" />);

    const gradient = gradientOf('cta');
    expect(gradient.type).toBe('linear-gradient');
    expect(gradient.direction).toBe('to right');
    expect(gradient.colorStops.map((stop) => stop.color)).toEqual([
      colors.primaryGradientStart,
      colors.primaryGradientEnd,
    ]);
  });

  it('renders its label in the on-primary color at bodyStrong weight', async () => {
    await render(<GradientButton label="Get Started" onPress={jest.fn()} testID="cta" />);

    const label = screen.getByText('Get Started');
    const labelStyle = StyleSheet.flatten(label.props.style as StyleProp<TextStyle>);
    expect(labelStyle.color).toBe(colors.onPrimary);
    expect(labelStyle).toMatchObject({
      fontSize: typography.bodyStrong.fontSize,
      fontWeight: typography.bodyStrong.fontWeight,
    });
  });

  it('fires onPress exactly once per press', async () => {
    const onPress = jest.fn<void, []>();
    await render(<GradientButton label="Get Started" onPress={onPress} testID="cta" />);

    await fireEvent.press(screen.getByTestId('cta'));

    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('takes the caller testID so each screen keeps its own CTA id', async () => {
    await render(
      <GradientButton label="Allow" onPress={jest.fn()} testID="permission-allow-cta" />,
    );

    expect(screen.getByTestId('permission-allow-cta')).toBeOnTheScreen();
  });

  it('merges a caller style without dropping its own gradient or height', async () => {
    // Screens pin the CTA to the bottom with their own margins; that must not
    // cost the button its identity.
    await render(
      <GradientButton
        label="Get Started"
        onPress={jest.fn()}
        style={{ marginBottom: 48 }}
        testID="cta"
      />,
    );

    const style = flattenedStyle('cta');
    expect(style.marginBottom).toBe(48);
    expect(style.height).toBe(sizing.buttonHeight);
    expect(gradientOf('cta').type).toBe('linear-gradient');
  });
});
