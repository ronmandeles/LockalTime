import React from 'react';
import { StyleSheet, View, type ColorValue } from 'react-native';

import { colors, radius, sizing } from '../theme/tokens';

// The Lockal Time ring mark: a thick-stroked circle with a solid dot at its
// centre. Drawn with two plain Views because this app has no icon library and
// no react-native-svg — adding one for a single mark would be the only
// native-linking risk in an otherwise pure-JS theme change, and two Views
// reproduce the shape exactly at any size.
//
// The ratios below were measured off the real 1024px app icon
// (ios/LockalTime/Images.xcassets/AppIcon.appiconset/icon-1024.png): outer
// diameter 664, stroke 64, inner dot 280. Expressing them as ratios rather
// than pixels is what lets the same component be the 160pt hero on Screen 1
// and the ~48pt glyph inside Screen 2's badge without distorting.
const RING_STROKE_RATIO = 64 / 664;
const INNER_DOT_RATIO = 280 / 664;

export interface LogoMarkProps {
  readonly size?: number;
  readonly color?: ColorValue;
  readonly testID?: string;
}

const LogoMark = ({
  size = sizing.heroLogo,
  color = colors.textPrimary,
  testID = 'logo-mark',
}: LogoMarkProps): React.JSX.Element => {
  // Rounded so the stroke lands on whole pixels; sub-pixel borders render
  // unevenly at the small end of the size range.
  const borderWidth = Math.round(size * RING_STROKE_RATIO);
  const dotSize = Math.round(size * INNER_DOT_RATIO);

  return (
    <View
      style={[styles.ring, { borderColor: color, borderWidth, height: size, width: size }]}
      testID={testID}
    >
      <View
        style={[styles.dot, { backgroundColor: color, height: dotSize, width: dotSize }]}
        testID={`${testID}-dot`}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  dot: {
    // radius.full over an arithmetic size / 2: the shape is "a circle", and
    // saying so once is what keeps it circular at every size.
    borderRadius: radius.full,
  },
  ring: {
    alignItems: 'center',
    borderRadius: radius.full,
    justifyContent: 'center',
  },
});

export default LogoMark;
