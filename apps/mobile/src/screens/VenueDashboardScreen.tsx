import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { useTranslation } from 'react-i18next';

import type { RootStackParamList } from '../navigation/types';
import { getVenueMetrics, listVenues } from '../services/api-client';
import type { VenueMetricsResponse, VenueResponse } from '../services/api-client';
import { radius, spacing, typography } from '../theme/tokens';

// B2B dashboard (Phase 6 task 6, ARCHITECTURE.md §10) — verified_host/admin
// only, reached only from Home's manageVenuesCta area (gated the same way
// as VenueManagementScreen). Aggregates only, no individual customers.
//
// Refresh policy: fetches on mount (same convention as every other screen
// in this codebase — CreateSessionScreen/VenueManagementScreen included),
// plus an explicit "Refresh" link as the pull-to-refresh equivalent — a
// RefreshControl/ScrollView would be more ceremony than two stat tiles
// warrant, and no screen here uses that pattern yet. A refetch-on-focus
// hook (useFocusEffect) was deliberately left out: it needs a real
// NavigationContainer to fire, which would mean introducing a new test
// setup pattern this screen's own tests don't otherwise need.
type VenueDashboardScreenProps = NativeStackScreenProps<RootStackParamList, 'VenueDashboard'>;

type VenuesLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly venues: readonly VenueResponse[] }
  | { readonly status: 'error' };

type MetricsLoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly metrics: VenueMetricsResponse }
  | { readonly status: 'error' };

const VenueDashboardScreen = (_props: VenueDashboardScreenProps): React.JSX.Element => {
  const { t } = useTranslation();
  const [venuesLoad, setVenuesLoad] = useState<VenuesLoadState>({ status: 'loading' });
  const [selectedVenueId, setSelectedVenueId] = useState<string | null>(null);
  const [metricsLoad, setMetricsLoad] = useState<MetricsLoadState | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);

  const loadVenues = useCallback(() => {
    setVenuesLoad({ status: 'loading' });
    listVenues().then((result) => {
      if (!result.ok) {
        setVenuesLoad({ status: 'error' });
        return;
      }
      setVenuesLoad({ status: 'loaded', venues: result.value.venues });
      setSelectedVenueId((current) => current ?? result.value.venues[0]?.id ?? null);
    });
  }, []);

  useEffect(() => {
    loadVenues();
  }, [loadVenues]);

  useEffect(() => {
    if (selectedVenueId === null) {
      setMetricsLoad(null);
      return undefined;
    }
    let cancelled = false;
    setMetricsLoad({ status: 'loading' });

    getVenueMetrics(selectedVenueId).then((result) => {
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setMetricsLoad({ status: 'error' });
        return;
      }
      setMetricsLoad({ status: 'loaded', metrics: result.value });
    });

    return () => {
      cancelled = true;
    };
  }, [selectedVenueId, refreshToken]);

  return (
    <View style={styles.container} testID="venue-dashboard-screen">
      <Text style={styles.title}>{t('venueDashboard.title')}</Text>

      {venuesLoad.status === 'error' && (
        <View>
          <Text style={styles.error}>{t('venueDashboard.loadError')}</Text>
          <TouchableOpacity onPress={loadVenues} testID="venue-dashboard-retry">
            <Text style={styles.retryLabel}>{t('venueDashboard.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {venuesLoad.status === 'loaded' && venuesLoad.venues.length === 0 && (
        <Text style={styles.body} testID="venue-dashboard-empty">
          {t('venueDashboard.noVenues')}
        </Text>
      )}

      {venuesLoad.status === 'loaded' && venuesLoad.venues.length > 1 && (
        <View style={styles.venuePicker} testID="venue-dashboard-picker">
          {venuesLoad.venues.map((venue) => (
            <TouchableOpacity
              key={venue.id}
              onPress={() => setSelectedVenueId(venue.id)}
              style={[styles.venueOption, selectedVenueId === venue.id && styles.venueOptionSelected]}
              testID={`venue-dashboard-venue-${venue.id}`}
            >
              <Text
                style={[
                  styles.venueOptionLabel,
                  selectedVenueId === venue.id && styles.venueOptionLabelSelected,
                ]}
              >
                {venue.name}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      )}

      {metricsLoad !== null && metricsLoad.status === 'loading' && (
        <Text style={styles.body} testID="venue-dashboard-loading">
          {t('venueDashboard.title')}
        </Text>
      )}

      {metricsLoad !== null && metricsLoad.status === 'error' && (
        <View>
          <Text style={styles.error}>{t('venueDashboard.loadError')}</Text>
          <TouchableOpacity
            onPress={() => setRefreshToken((token) => token + 1)}
            testID="venue-dashboard-metrics-retry"
          >
            <Text style={styles.retryLabel}>{t('venueDashboard.retry')}</Text>
          </TouchableOpacity>
        </View>
      )}

      {metricsLoad !== null && metricsLoad.status === 'loaded' && (
        <View testID="venue-dashboard-metrics">
          <View style={styles.statTile}>
            <Text style={styles.statValue} testID="venue-dashboard-concurrent">
              {metricsLoad.metrics.concurrentActiveCustomers}
            </Text>
            <Text style={styles.statCaption}>{t('venueDashboard.concurrentCustomers')}</Text>
          </View>

          <View style={styles.statTile}>
            <Text style={styles.statValue} testID="venue-dashboard-avg-minutes">
              {Math.round(metricsLoad.metrics.avgMinutesPerCustomer)}
            </Text>
            <Text style={styles.statCaption}>
              {t('venueDashboard.avgMinutesPerCustomer', { count: metricsLoad.metrics.windowDays })}
            </Text>
          </View>

          <Text style={styles.sessionsInWindow} testID="venue-dashboard-sessions-in-window">
            {t('venueDashboard.sessionsInWindow', {
              count: metricsLoad.metrics.sessionsInWindow,
              days: metricsLoad.metrics.windowDays,
            })}
          </Text>

          <TouchableOpacity
            onPress={() => setRefreshToken((token) => token + 1)}
            testID="venue-dashboard-refresh"
          >
            <Text style={styles.retryLabel}>{t('venueDashboard.refresh')}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

// Neutral grayscale only — the color palette is intentionally deferred.
const styles = StyleSheet.create({
  body: {
    ...typography.body,
    color: '#444444',
    marginTop: spacing.md,
  },
  container: {
    backgroundColor: '#FFFFFF',
    flex: 1,
    paddingBottom: spacing.xl,
    paddingEnd: spacing.xl,
    paddingStart: spacing.xl,
    paddingTop: spacing.xl,
  },
  error: {
    ...typography.caption,
    color: '#B00020',
    marginTop: spacing.md,
  },
  retryLabel: {
    ...typography.bodyStrong,
    color: '#222222',
    marginTop: spacing.lg,
  },
  sessionsInWindow: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.sm,
  },
  statCaption: {
    ...typography.caption,
    color: '#666666',
    marginTop: spacing.xs,
  },
  statTile: {
    backgroundColor: '#F5F5F5',
    borderRadius: radius.xl,
    marginTop: spacing.lg,
    padding: spacing.lg,
  },
  statValue: {
    ...typography.display,
    color: '#222222',
  },
  title: {
    ...typography.heading,
    color: '#222222',
  },
  venueOption: {
    borderColor: '#CCCCCC',
    borderRadius: radius.md,
    borderWidth: 1,
    justifyContent: 'center',
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  venueOptionLabel: {
    ...typography.body,
    color: '#444444',
  },
  venueOptionLabelSelected: {
    color: '#FFFFFF',
  },
  venueOptionSelected: {
    backgroundColor: '#222222',
    borderColor: '#222222',
  },
  venuePicker: {
    marginTop: spacing.md,
  },
});

export default VenueDashboardScreen;
