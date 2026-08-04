import React from 'react';
import {
  StyleSheet,
  Text,
  TouchableOpacity,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { colors, radius, sizing, typography } from '../theme/tokens';

// The primary CTA for the onboarding flow (Screens 1-3): full-width, rounded,
// filled with a left-to-right navy gradient. Extracted into one component
// because the gradient literal would otherwise be copy-pasted into three
// screens — three places for the two stops to drift apart, and three
// violations of the "screens hold no ad-hoc style values" rule.
//
// The gradient uses React Native's BUILT-IN CSS gradient support
// (`experimental_backgroundImage`, available on the new architecture, which
// this app already enables) instead of a native gradient package. That buys
// no Podfile change, no Gradle change, no Jest mock, and no risk to the macOS
// iOS build job — for one button. The `experimental_` prefix is the accepted
// cost: if a future RN upgrade renames the property, it is renamed here and
// nowhere else.
//
// The direction is 'to right' unconditionally, including under RTL. A
// gradient is a paint instruction rather than layout, so RN does not mirror
// it, and branching a style on locale is forbidden by the i18n conventions.
// The asymmetry is subtle; judging it on a real RTL device is a manual-QA
// item (docs/MANUAL_QA.md).
export interface GradientButtonProps {
  readonly label: string;
  readonly onPress: () => void;
  readonly style?: StyleProp<ViewStyle>;
  readonly testID?: string;
}

const GradientButton = ({
  label,
  onPress,
  style,
  testID,
}: GradientButtonProps): React.JSX.Element => (
  <TouchableOpacity onPress={onPress} style={[styles.button, style]} testID={testID}>
    <Text style={styles.label}>{label}</Text>
  </TouchableOpacity>
);

const styles = StyleSheet.create({
  button: {
    alignItems: 'center',
    borderRadius: radius.lg,
    experimental_backgroundImage: [
      {
        type: 'linear-gradient',
        direction: 'to right',
        colorStops: [
          { color: colors.primaryGradientStart },
          { color: colors.primaryGradientEnd },
        ],
      },
    ],
    height: sizing.buttonHeight,
    justifyContent: 'center',
  },
  label: {
    ...typography.bodyStrong,
    color: colors.onPrimary,
  },
});

export default GradientButton;
