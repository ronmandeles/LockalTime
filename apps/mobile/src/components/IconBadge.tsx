import React from 'react';
import { StyleSheet, View } from 'react-native';

import { colors, radius, sizing } from '../theme/tokens';

// The tinted accent circle that sits above the permission-priming title,
// holding a glyph. Its own component rather than a bare style object because
// it owns a layout invariant — centre the child on both axes — not just a
// fill; a glyph drifting inside a circle is exactly the kind of defect that
// only ever gets caught by eye.
export interface IconBadgeProps {
  readonly children: React.ReactNode;
  readonly testID?: string;
}

const IconBadge = ({ children, testID }: IconBadgeProps): React.JSX.Element => (
  <View style={styles.badge} testID={testID}>
    {children}
  </View>
);

const styles = StyleSheet.create({
  badge: {
    alignItems: 'center',
    // The accent at ~12% over black: enough to read as an accent surface,
    // not enough to compete with the CTA below it.
    backgroundColor: colors.primarySubtle,
    borderRadius: radius.full,
    height: sizing.iconBadge,
    justifyContent: 'center',
    width: sizing.iconBadge,
  },
});

export default IconBadge;
