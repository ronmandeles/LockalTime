import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { resolveAppName } from '../config/app-catalog';
import { BLOCKED_CATEGORY_VALUES, type BlockedCategory } from '../config/blocked-categories';
import { blockableAppSource, type BlockableApp } from '../services/blockable-app-source';
import type { BlocklistSelection } from '../state/blocklist-preference-store';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// The Create Session blocklist picker (docs/BLOCKLIST_SELECTION_PLAN.md §7):
// six category toggles plus a list of specific apps, read through
// blockable-app-source.ts so Android's real enumeration and iOS's bundled
// catalog are the same component.
//
// Everything it emits is a plain string — a category name or a package
// name. That is the whole point: those mean something on every member's
// device, where an opaque per-device handle would not.

interface BlocklistPickerProps {
  readonly selection: BlocklistSelection;
  readonly onChange: (next: BlocklistSelection) => void;
  // Non-null only for a static_qr session at a venue, whose blocklist must
  // fall inside what the venue was approved for out of band (§3). Narrowing
  // the picker is the courteous half; the server rejecting anything else is
  // the half that actually holds.
  readonly approved: BlocklistSelection | null;
}

type ListingState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly apps: readonly BlockableApp[] };

interface AppRow {
  readonly id: string;
  readonly name: string;
  readonly installed: BlockableApp['installed'];
  readonly isSelected: boolean;
}

const BlocklistPicker = ({
  selection,
  onChange,
  approved,
}: BlocklistPickerProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [listingState, setListingState] = useState<ListingState>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    blockableAppSource
      .listApps()
      .then((apps) => {
        if (!cancelled) {
          setListingState({ status: 'loaded', apps });
        }
      })
      .catch(() => {
        // An unreachable source is an empty list, never an error state the
        // host has to dismiss — the category toggles alone still make a
        // valid session.
        if (!cancelled) {
          setListingState({ status: 'loaded', apps: [] });
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, []);

  const categories: readonly BlockedCategory[] =
    approved === null ? BLOCKED_CATEGORY_VALUES : approved.categories;

  const rows: readonly AppRow[] = useMemo(() => {
    if (listingState.status !== 'loaded') {
      return [];
    }
    const offered =
      approved === null
        ? listingState.apps
        : listingState.apps.filter((app) => approved.packages.includes(app.id));
    const offeredIds = new Set(offered.map((app) => app.id));

    // A selection carried over from a previous session that the source no
    // longer offers still gets a row. An invisible selection that is
    // nonetheless submitted is the worse outcome — the host has to be able
    // to see and turn it off.
    //
    // Always 'unknown', never 'not_installed'. The catalog is the queryable
    // set on both platforms now, so an entry outside it cannot be asked
    // about at all — its absence here means "we have never heard of this
    // app", which is not a statement about the host's phone.
    const carriedOver: readonly AppRow[] = selection.packages
      .filter((packageName) => !offeredIds.has(packageName))
      .map((packageName) => ({
        id: packageName,
        name: resolveAppName(packageName),
        installed: 'unknown' as const,
        isSelected: true,
      }));

    return [
      ...offered.map((app) => ({
        id: app.id,
        name: app.name,
        installed: app.installed,
        isSelected: selection.packages.includes(app.id),
      })),
      ...carriedOver,
    ];
  }, [listingState, approved, selection.packages]);

  const notInstalledCount = rows.filter(
    (row) => row.isSelected && row.installed === 'not_installed',
  ).length;

  const toggleCategory = (category: BlockedCategory): void => {
    const next = selection.categories.includes(category)
      ? selection.categories.filter((existing) => existing !== category)
      : [...selection.categories, category];
    onChange({ categories: next, packages: selection.packages });
  };

  const togglePackage = (packageName: string): void => {
    const next = selection.packages.includes(packageName)
      ? selection.packages.filter((existing) => existing !== packageName)
      : [...selection.packages, packageName];
    onChange({ categories: selection.categories, packages: next });
  };

  const renderRow = ({ item }: { item: AppRow }): React.JSX.Element => (
    <TouchableOpacity
      onPress={() => togglePackage(item.id)}
      style={[styles.appRow, item.isSelected && styles.appRowSelected]}
      testID={`blocklist-app-${item.id}`}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: item.isSelected }}
    >
      {/* App names stay in their own Text node rather than being
          interpolated into a sentence: they are Latin brand names that sit
          inside Hebrew copy, and the bidi algorithm would otherwise reorder
          punctuation around them (i18n skill). */}
      <Text style={[styles.appName, item.isSelected && styles.appNameSelected]}>{item.name}</Text>
    </TouchableOpacity>
  );

  return (
    // flexShrink so the app list absorbs whatever vertical space the form
    // above it leaves, rather than the page overflowing on a small screen.
    // The list is the only scroller here on purpose — a FlatList nested in
    // a same-axis ScrollView loses its virtualization, and ~200 rows is
    // exactly the case virtualization exists for (plan §7).
    <View testID="blocklist-picker" style={styles.root}>
      <Text style={styles.label}>{t('createSession.blocklist.label')}</Text>

      <Text style={styles.sublabel}>{t('createSession.blocklist.categoriesLabel')}</Text>
      <View style={styles.categoryGrid}>
        {categories.map((category) => {
          const isSelected = selection.categories.includes(category);
          return (
            <TouchableOpacity
              key={category}
              onPress={() => toggleCategory(category)}
              style={[styles.categoryChip, isSelected && styles.categoryChipSelected]}
              testID={`blocklist-category-${category}`}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isSelected }}
            >
              <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
                {t(`createSession.blocklist.category.${category}` as never)}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Text style={styles.note}>{t('createSession.blocklist.categoriesNote')}</Text>

      {/* Plan §1: maps earns a note rather than a denylist entry. Blocking
          navigation is inconvenient, not emergency-critical the way the
          dialer is, and the emergency exit is always available. */}
      {selection.categories.includes('maps') && (
        <Text style={styles.note} testID="blocklist-maps-note">
          {t('createSession.blocklist.mapsNote')}
        </Text>
      )}

      {approved !== null && (
        <Text style={styles.note} testID="blocklist-venue-note">
          {t('createSession.blocklist.venueNote')}
        </Text>
      )}

      <Text style={styles.sublabel}>{t('createSession.blocklist.appsLabel')}</Text>

      {listingState.status === 'loading' && (
        <Text style={styles.note}>{t('createSession.blocklist.appsLoading')}</Text>
      )}

      {listingState.status === 'loaded' && rows.length === 0 && (
        <Text style={styles.note}>{t('createSession.blocklist.appsEmpty')}</Text>
      )}

      {/* FlatList, not a map() into the parent ScrollView: this can be ~200
          rows on a real device and needs virtualization (plan §7). */}
      {listingState.status === 'loaded' && rows.length > 0 && (
        <FlatList
          data={rows}
          keyExtractor={(item) => item.id}
          renderItem={renderRow}
          style={styles.appList}
          testID="blocklist-app-list"
          initialNumToRender={12}
          // Each row's onPress closes over the WHOLE current selection —
          // toggling an app has to preserve the categories chosen a moment
          // ago. `rows` alone doesn't change when only a category does, so
          // without this the cells keep a stale closure and a category
          // picked just before tapping an app is silently dropped.
          extraData={selection}
        />
      )}

      {notInstalledCount > 0 && (
        <Text style={styles.note} testID="blocklist-not-installed-note">
          {t('createSession.blocklist.notInstalledNote', { count: notInstalledCount })}
        </Text>
      )}
    </View>
  );
};

// DESIGN_GUIDELINES §12 tokens only, no literals. Logical properties
// throughout so the whole picker flips correctly under RTL (i18n skill).
const styles = StyleSheet.create({
  appList: {
    flexShrink: 1,
    marginTop: spacing.sm,
    maxHeight: sizing.buttonHeight * 5,
  },
  appName: {
    ...typography.body,
    color: colors.textSecondary,
  },
  appNameSelected: {
    color: colors.onPrimary,
  },
  appRow: {
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.xs,
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  appRowSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryChip: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    paddingHorizontal: spacing.md,
  },
  categoryChipSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  categoryLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  categoryLabelSelected: {
    color: colors.onPrimary,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  root: {
    flexShrink: 1,
  },
  sublabel: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});

export default BlocklistPicker;
