import React, { useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import type { BlockedCategory } from '../config/blocked-categories';
import { describeBlocklist } from '../services/blocklist-display';
import { colors, radius, spacing, typography } from '../theme/tokens';

// What this session is blocking, on Active Session (Screen 6)
// (docs/BLOCKLIST_SELECTION_PLAN.md §7, owner decision: full list,
// expandable). The pre-join screen is easy to forget an hour in, and
// someone who has just hit a block wants to know why.
//
// **Read-only by construction** — no callback, no edit affordance. The
// blocklist is frozen for the session's lifetime (§9a), and that is a real
// anti-abuse position rather than a simplification: host migration promotes
// whoever has the most minutes present, which a group could arrange
// deliberately to hand the role to a confederate who unblocks everything
// while everyone keeps earning.
//
// No fetch of its own: this is the same session-scoped list `fetchSession`
// already hydrated.

interface BlocklistSummaryProps {
  readonly categories: readonly BlockedCategory[];
  readonly packages: readonly string[];
}

// Enough to recognise the session at a glance without becoming a wall of
// text next to the timer, which DESIGN_GUIDELINES §0 keeps deliberately
// quiet.
const COLLAPSED_LIMIT = 2;

const BlocklistSummary = ({
  categories,
  packages,
}: BlocklistSummaryProps): React.JSX.Element | null => {
  const { t } = useTranslation();
  const [isExpanded, setIsExpanded] = useState(false);

  const labels = describeBlocklist(categories, packages, (category) =>
    t(`createSession.blocklist.category.${category}` as never),
  );

  // The DB forbids an empty blocklist and the API rejects one, so this is
  // unreachable — but rendering "Blocking:" followed by nothing would be
  // worse than rendering nothing.
  if (labels.length === 0) {
    return null;
  }

  const visible = isExpanded ? labels : labels.slice(0, COLLAPSED_LIMIT);
  const hiddenCount = labels.length - visible.length;

  return (
    <TouchableOpacity
      onPress={() => setIsExpanded((expanded) => !expanded)}
      style={styles.container}
      testID="active-session-blocklist"
      accessibilityRole="button"
      accessibilityState={{ expanded: isExpanded }}
      accessibilityLabel={t('activeSession.blocklist.accessibilityLabel')}
    >
      <Text style={styles.label}>{t('activeSession.blocklist.label')}</Text>
      {/* Each name is its own Text node rather than interpolated into a
          sentence: they are Latin brand names sitting inside Hebrew copy,
          and the bidi algorithm would otherwise reorder the punctuation
          around them (i18n skill). */}
      <View style={styles.items}>
        {visible.map((label) => (
          <Text key={label} style={styles.item}>
            {label}
          </Text>
        ))}
        {hiddenCount > 0 && (
          <Text style={styles.more} testID="active-session-blocklist-more">
            {t('activeSession.blocklist.more', { count: hiddenCount })}
          </Text>
        )}
      </View>
    </TouchableOpacity>
  );
};

// DESIGN_GUIDELINES §12 tokens only; logical properties throughout so the
// whole block flips correctly under RTL (i18n skill).
const styles = StyleSheet.create({
  container: {
    borderColor: colors.border,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  item: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  items: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  label: {
    ...typography.caption,
    color: colors.textPrimary,
  },
  more: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});

export default BlocklistSummary;
