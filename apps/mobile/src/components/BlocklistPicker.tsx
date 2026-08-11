import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { useTranslation } from 'react-i18next';

import { resolveAppName } from '../config/app-catalog';
import { BLOCKED_CATEGORY_VALUES, type BlockedCategory } from '../config/blocked-categories';
import { blockableAppSource, type BlockableApp } from '../services/blockable-app-source';
import type { BlocklistSelection } from '../state/blocklist-preference-store';
import { colors, radius, sizing, spacing, typography } from '../theme/tokens';

// The Create Session blocklist picker (docs/BLOCKLIST_SELECTION_PLAN.md §7):
// six category rows plus a list of specific apps, read through
// blockable-app-source.ts so Android's and iOS's answers to "do you have
// this one?" reach the same component.
//
// Everything it emits is a plain string — a category name or a package
// name. That is the whole point: those mean something on every member's
// device, where an opaque per-device handle would not.
//
// **Each category row opens** (owner decision 2026-08-11) to show the apps
// we can name inside it, so "Social" is not a word the host has to take on
// trust. Two things about that list are easy to get wrong:
//
//   * It is NOT the boundary of what the category blocks. Enforcement
//     matches on the device's own category (ApplicationInfo.category /
//     Apple's category tokens), which covers apps we have never heard of
//     and apps installed later. The drawer says so in its own copy —
//     without that note the screen promises something the blocker doesn't
//     keep.
//   * It is the same rows as the flat list below, sharing one selection.
//     An app ticked in one place is ticked in both, because both read
//     `selection.packages` — there is no second source of truth to drift.
//
// One category is open at a time. Social alone is 32 rows in the real
// catalog, and this component owns the only scroller on the screen.

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
  // null for a carried-over selection the source no longer offers: we have
  // no category to file it under, so it appears in the flat list only.
  // Never guessed from the catalog — under a venue narrowing that would
  // smuggle an unapproved app back into an approved category's drawer.
  readonly category: BlockedCategory | null;
  readonly isSelected: boolean;
}

// One flat row stream through one FlatList, because there is exactly one
// scroller. The screen this sits on is a non-scrolling View
// (CreateSessionScreen), so anything the picker adds has to be reachable
// *here* or it is simply off the bottom of a small phone.
//
// Headings and notes are rows rather than a SectionList's own header and
// footer slots: SectionList's extra machinery does not survive this
// project's test environment (its mount stalls before the effect that loads
// the apps ever runs), and one list of tagged rows needs none of it.
type PickerRow =
  | { readonly kind: 'heading'; readonly section: PickerSectionKey }
  | { readonly kind: 'category'; readonly category: BlockedCategory }
  | { readonly kind: 'categoryNote'; readonly category: BlockedCategory }
  | { readonly kind: 'categoryApp'; readonly app: AppRow }
  | { readonly kind: 'app'; readonly app: AppRow }
  | { readonly kind: 'notes'; readonly section: PickerSectionKey };

type PickerSectionKey = 'categories' | 'apps';

// The same app is a row twice over — once inside its category, once in the
// flat list — so the kind is part of the key, not just the id.
const keyOf = (item: PickerRow): string => {
  switch (item.kind) {
    case 'heading':
    case 'notes':
      return `${item.kind}:${item.section}`;
    case 'category':
    case 'categoryNote':
      return `${item.kind}:${item.category}`;
    case 'categoryApp':
    case 'app':
      return `${item.kind}:${item.app.id}`;
  }
};

const BlocklistPicker = ({
  selection,
  onChange,
  approved,
}: BlocklistPickerProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [listingState, setListingState] = useState<ListingState>({ status: 'loading' });
  const [expandedCategory, setExpandedCategory] = useState<BlockedCategory | null>(null);

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
        category: null,
        isSelected: true,
      }));

    return [
      ...offered.map((app) => ({
        id: app.id,
        name: app.name,
        installed: app.installed,
        category: app.category,
        isSelected: selection.packages.includes(app.id),
      })),
      ...carriedOver,
    ];
  }, [listingState, approved, selection.packages]);

  const rowsByCategory = useMemo(() => {
    const grouped = new Map<BlockedCategory, AppRow[]>();
    rows.forEach((row) => {
      if (row.category === null) {
        return;
      }
      const bucket = grouped.get(row.category);
      if (bucket === undefined) {
        grouped.set(row.category, [row]);
      } else {
        bucket.push(row);
      }
    });
    return grouped;
  }, [rows]);

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

  const pickerRows: readonly PickerRow[] = [
    { kind: 'heading', section: 'categories' },
    ...categories.flatMap((category): readonly PickerRow[] => {
      const head: PickerRow = { kind: 'category', category };
      if (expandedCategory !== category) {
        return [head];
      }
      return [
        head,
        { kind: 'categoryNote', category },
        ...(rowsByCategory.get(category) ?? []).map(
          (app): PickerRow => ({ kind: 'categoryApp', app }),
        ),
      ];
    }),
    { kind: 'notes', section: 'categories' },
    { kind: 'heading', section: 'apps' },
    ...rows.map((app): PickerRow => ({ kind: 'app', app })),
    { kind: 'notes', section: 'apps' },
  ];

  const renderAppRow = (app: AppRow, testID: string, isNested: boolean): React.JSX.Element => (
    <TouchableOpacity
      onPress={() => togglePackage(app.id)}
      style={[styles.appRow, isNested && styles.appRowNested, app.isSelected && styles.appRowSelected]}
      testID={testID}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: app.isSelected }}
    >
      {/* App names stay in their own Text node rather than being
          interpolated into a sentence: they are Latin brand names that sit
          inside Hebrew copy, and the bidi algorithm would otherwise reorder
          punctuation around them (i18n skill). */}
      <Text style={[styles.appName, app.isSelected && styles.appNameSelected]}>{app.name}</Text>
    </TouchableOpacity>
  );

  const renderCategoryRow = (category: BlockedCategory): React.JSX.Element => {
    const isSelected = selection.categories.includes(category);
    const isExpanded = expandedCategory === category;
    const namedCount = rowsByCategory.get(category)?.length ?? 0;

    return (
      <View style={[styles.categoryRow, isSelected && styles.categoryRowSelected]}>
        <TouchableOpacity
          onPress={() => toggleCategory(category)}
          style={styles.categoryToggle}
          testID={`blocklist-category-${category}`}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isSelected }}
        >
          <Text style={[styles.categoryLabel, isSelected && styles.categoryLabelSelected]}>
            {t(`createSession.blocklist.category.${category}` as never)}
          </Text>
        </TouchableOpacity>

        {/* No drawer for a category we can name nothing in — it still blocks
            everything the device files under it, but an empty drawer would
            only read as broken. */}
        {namedCount > 0 && (
          <TouchableOpacity
            onPress={() => setExpandedCategory(isExpanded ? null : category)}
            style={styles.categoryExpander}
            testID={`blocklist-category-expand-${category}`}
            accessibilityRole="button"
            accessibilityState={{ expanded: isExpanded }}
            accessibilityLabel={t(
              isExpanded ? 'createSession.blocklist.hideApps' : 'createSession.blocklist.showApps',
            )}
          >
            <Text
              style={[styles.categoryCount, isSelected && styles.categoryCountSelected]}
              testID={`blocklist-category-count-${category}`}
            >
              {t('createSession.blocklist.appCount', { count: namedCount })}
            </Text>
            <View
              style={[
                styles.chevron,
                isExpanded && styles.chevronExpanded,
                isSelected && styles.chevronSelected,
              ]}
            />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  const renderNotes = (section: PickerSectionKey): React.JSX.Element =>
    section === 'categories' ? (
      <View>
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
      </View>
    ) : (
      <View>
        {listingState.status === 'loading' && (
          <Text style={styles.note}>{t('createSession.blocklist.appsLoading')}</Text>
        )}

        {listingState.status === 'loaded' && rows.length === 0 && (
          <Text style={styles.note}>{t('createSession.blocklist.appsEmpty')}</Text>
        )}

        {notInstalledCount > 0 && (
          <Text style={styles.note} testID="blocklist-not-installed-note">
            {t('createSession.blocklist.notInstalledNote', { count: notInstalledCount })}
          </Text>
        )}
      </View>
    );

  const renderRow = ({ item }: { item: PickerRow }): React.JSX.Element => {
    switch (item.kind) {
      case 'heading':
        return (
          <Text style={styles.sublabel}>
            {t(
              item.section === 'categories'
                ? 'createSession.blocklist.categoriesLabel'
                : 'createSession.blocklist.appsLabel',
            )}
          </Text>
        );
      case 'notes':
        return renderNotes(item.section);
      case 'category':
        return renderCategoryRow(item.category);
      case 'categoryNote':
        return (
          <View style={styles.categoryNotes} testID={`blocklist-category-note-${item.category}`}>
            <Text style={styles.note}>{t('createSession.blocklist.categoryAppsNote')}</Text>
            {selection.categories.includes(item.category) && (
              <Text style={styles.note}>{t('createSession.blocklist.categoryCoveredNote')}</Text>
            )}
          </View>
        );
      case 'categoryApp':
        return renderAppRow(item.app, `blocklist-category-app-${item.app.id}`, true);
      case 'app':
        return renderAppRow(item.app, `blocklist-app-${item.app.id}`, false);
    }
  };

  return (
    // flex so the picker absorbs whatever vertical space the form above it
    // leaves. One list carries the headings, the categories, an open
    // category's apps and the flat app list, so all of it scrolls together —
    // the screen itself does not scroll, and a second same-axis scroller
    // here would fight this one.
    <View testID="blocklist-picker" style={styles.root}>
      <FlatList
        data={pickerRows}
        keyExtractor={keyOf}
        renderItem={renderRow}
        ListHeaderComponent={<Text style={styles.label}>{t('createSession.blocklist.label')}</Text>}
        style={styles.list}
        testID="blocklist-app-list"
        // The category rows sit ahead of the app rows in one virtualized
        // stream, so the first window has to clear them before an app row
        // renders at all. ~200 rows is still exactly the case virtualization
        // exists for (plan §7); this only widens that first window.
        initialNumToRender={20}
        // Each row's onPress closes over the WHOLE current selection —
        // toggling an app has to preserve the categories chosen a moment
        // ago. `pickerRows` alone doesn't tell a cell that only a category
        // changed, so without this the cells keep a stale closure and a
        // category picked just before tapping an app is silently dropped.
        extraData={selection}
      />
    </View>
  );
};

// DESIGN_GUIDELINES §12 tokens only, no literals. Logical properties
// throughout so the whole picker flips correctly under RTL (i18n skill).
const styles = StyleSheet.create({
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
  appRowNested: {
    marginStart: spacing.md,
  },
  appRowSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryCount: {
    ...typography.caption,
    color: colors.textMuted,
  },
  categoryCountSelected: {
    color: colors.onPrimary,
  },
  categoryExpander: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    paddingEnd: spacing.md,
    paddingStart: spacing.sm,
  },
  categoryLabel: {
    ...typography.body,
    color: colors.textSecondary,
  },
  categoryLabelSelected: {
    color: colors.onPrimary,
  },
  categoryNotes: {
    marginStart: spacing.md,
    marginTop: spacing.xs,
  },
  categoryRow: {
    alignItems: 'center',
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    borderWidth: 1,
    flexDirection: 'row',
    marginTop: spacing.sm,
    minHeight: sizing.minTouchTarget,
  },
  categoryRowSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  categoryToggle: {
    flex: 1,
    justifyContent: 'center',
    minHeight: sizing.minTouchTarget,
    paddingStart: spacing.md,
  },
  chevron: {
    // Physical borders and a fixed rotation on purpose: this is a glyph, not
    // a layout. A chevron pointing down means "opens", not "forward", so it
    // must NOT mirror under RTL the way logical edges would (i18n skill).
    borderBottomWidth: 2,
    borderColor: colors.textMuted,
    borderRightWidth: 2,
    height: 8,
    marginStart: spacing.sm,
    transform: [{ rotate: '45deg' }],
    width: 8,
  },
  chevronExpanded: {
    transform: [{ rotate: '-135deg' }],
  },
  chevronSelected: {
    borderColor: colors.onPrimary,
  },
  label: {
    ...typography.bodyStrong,
    color: colors.textPrimary,
    marginTop: spacing.lg,
  },
  list: {
    flex: 1,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginTop: spacing.xs,
  },
  root: {
    flex: 1,
  },
  sublabel: {
    ...typography.body,
    color: colors.textSecondary,
    marginTop: spacing.md,
  },
});

export default BlocklistPicker;
