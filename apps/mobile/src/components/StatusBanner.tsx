import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// Phase 6 task 7: the app's first shared UI primitive besides QrCodeCamera
// — three call sites justify it (blocker violation, host-migration toast,
// offline). Differentiated by weight and placement, not colour
// (DESIGN_GUIDELINES §11 defers semantic colours) — 'prominent' is bolder
// text on the same neutral card, never a different hue. No haptic firing
// here despite §8's taxonomy: no haptics library is wired into this
// codebase yet (a pre-existing gap, not introduced by this component) —
// tracked in docs/MANUAL_QA.md rather than added as a new native
// dependency mid-phase.
export type StatusBannerWeight = 'quiet' | 'prominent';

export interface StatusBannerProps {
  readonly message: string;
  readonly weight?: StatusBannerWeight;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly testID?: string;
}

const StatusBanner = ({
  message,
  weight = 'quiet',
  actionLabel,
  onAction,
  testID,
}: StatusBannerProps): React.JSX.Element => (
  <View
    style={[styles.container, weight === 'prominent' && styles.containerProminent]}
    testID={testID}
  >
    <Text style={[styles.message, weight === 'prominent' && styles.messageProminent]}>
      {message}
    </Text>
    {actionLabel !== undefined && onAction !== undefined && (
      <TouchableOpacity
        onPress={onAction}
        testID={testID !== undefined ? `${testID}-action` : undefined}
      >
        <Text style={styles.actionLabel}>{actionLabel}</Text>
      </TouchableOpacity>
    )}
  </View>
);

// Phase 7 (Release Prep): real palette tokens (DESIGN_GUIDELINES §12).
const styles = StyleSheet.create({
  actionLabel: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
  container: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  containerProminent: {
    borderColor: colors.warning,
    borderWidth: 1,
  },
  message: {
    ...typography.body,
    color: colors.textPrimary,
  },
  messageProminent: {
    ...typography.bodyStrong,
  },
});

export default StatusBanner;
