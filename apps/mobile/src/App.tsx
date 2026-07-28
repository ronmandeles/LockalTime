import React, { useEffect, useState } from 'react';

import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { i18n as I18nInstance } from 'i18next';

import { I18nProvider } from './i18n/I18nProvider';
import { initI18n } from './i18n/init-i18n';
import type { SupportedLocale } from './i18n/resolve-device-locale';
import { syncLayoutDirection } from './i18n/sync-layout-direction';
import type { RootStackParamList } from './navigation/types';
import ActiveSessionScreen from './screens/ActiveSessionScreen';
import AuthScreen from './screens/AuthScreen';
import CreateSessionScreen from './screens/CreateSessionScreen';
import EmergencyExitScreen from './screens/EmergencyExitScreen';
import FriendsScreen from './screens/FriendsScreen';
import HistoryScreen from './screens/HistoryScreen';
import HomeScreen from './screens/HomeScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import PermissionPrimingScreen from './screens/PermissionPrimingScreen';
import ScanSessionScreen from './screens/ScanSessionScreen';
import SessionCompletionScreen from './screens/SessionCompletionScreen';
import SessionDetailsScreen from './screens/SessionDetailsScreen';
import SettingsScreen from './screens/SettingsScreen';
import StatsScreen from './screens/StatsScreen';
import VenueDashboardScreen from './screens/VenueDashboardScreen';
import VenueManagementScreen from './screens/VenueManagementScreen';
import WelcomeBackScreen from './screens/WelcomeBackScreen';
import {
  registerPushTokenIfChanged,
  reportLocaleIfChanged,
  reportTimezoneIfChanged,
} from './services/user-profile';
import { hydrateActiveSessionStatus, useActiveSessionStore } from './state/active-session-store';
import { attachAuthStateListener, useAuthStore } from './state/auth-store';
import { hydrateOnboardingStatus, markOnboardingSeen, useOnboardingStore } from './state/onboarding-store';
import {
  hydratePermissionStepStatus,
  markPermissionStepHandled,
  usePermissionStore,
} from './state/permission-store';
import { hydrateProfile, resetProfile } from './state/profile-store';

// Testable app factory (the runtime shell is index.js, which only registers
// this component) — mirrors the app.ts/server.ts split in apps/server.
const RootStack = createNativeStackNavigator<RootStackParamList>();

// Completing or skipping onboarding marks the persisted flag; the store flip
// re-renders the gate below onto the navigator. Intentionally not awaited:
// the store flips optimistically and its write-failure path is fail-open, so
// the returned promise never rejects and carries nothing to wait for.
const handleOnboardingComplete = (): void => {
  markOnboardingSeen();
};

// Handling the permission step (granted request or the denied fallback's
// proceed-anyway — indistinguishable to the gate by design: the flag records
// that the step was handled, never that blocking works) marks the persisted
// flag; same optimistic, fail-open, not-awaited shape as onboarding above.
const handlePermissionHandled = (): void => {
  markPermissionStepHandled();
};

const App = (): React.JSX.Element | null => {
  const [i18nInstance, setI18nInstance] = useState<I18nInstance | null>(null);
  const onboarding = useOnboardingStore((state) => state.onboarding);
  const permissionStep = usePermissionStore((state) => state.permissionStep);
  const auth = useAuthStore((state) => state.auth);
  const authenticatedUserId = auth.status === 'authenticated' ? auth.session.user.id : null;
  const activeSession = useActiveSessionStore((state) => state.activeSession);
  const pendingWelcomeBackNavigation = useActiveSessionStore(
    (state) => state.pendingWelcomeBackNavigation,
  );

  useEffect(() => {
    let isMounted = true;
    // Attach before anything renders so cold-start session hydration
    // (INITIAL_SESSION from AsyncStorage) lands in the auth store; detached
    // in cleanup so remounts never leak listeners.
    const detachAuthListener = attachAuthStateListener();

    // First-launch gate hydrations run alongside i18n init; all async reads
    // resolve before anything renders (see the null gate below). Not awaited:
    // completion is observed through the stores, and the promises never
    // reject (fail-open inside the stores).
    hydrateOnboardingStatus();
    hydratePermissionStepStatus();
    hydrateActiveSessionStatus();

    initI18n().then((instance) => {
      // initI18n only ever resolves to a supported language, so narrowing by
      // check (not assertion) recovers the locale for the layout sync.
      const locale: SupportedLocale = instance.language === 'he' ? 'he' : 'en';
      syncLayoutDirection(locale);
      if (isMounted) {
        setI18nInstance(instance);
      }
    });

    return () => {
      isMounted = false;
      detachAuthListener();
    };
  }, []);

  // Phase 5: reports the device timezone once per authenticated session
  // (see services/user-profile.ts — never rejects, so no .catch() needed
  // here) so the server can bucket this user's finalized sessions into
  // their LOCAL day rather than UTC. Keyed on the user id specifically,
  // not just "is authenticated", so it fires again on a genuine user
  // switch but not on every unrelated re-render while signed in.
  useEffect(() => {
    if (authenticatedUserId !== null) {
      reportTimezoneIfChanged(authenticatedUserId);
      // Phase 5.5: same fire-and-forget, never-rejects posture as the
      // timezone report above — reportLocaleIfChanged lets server-composed
      // notifications (the streak-risk push) be localized;
      // registerPushTokenIfChanged is a no-op today (no real push SDK
      // linked yet, push-registration.ts) but wired for when one lands.
      reportLocaleIfChanged(authenticatedUserId);
      registerPushTokenIfChanged(authenticatedUserId);
      // Phase 6: re-hydrated fresh every authenticated session (never
      // persisted) so a manual runbook role flip is picked up on next
      // sign-in without a stale cached value.
      hydrateProfile(authenticatedUserId);
    } else {
      // A sign-out (or a cold start with no session) must not leave a
      // PREVIOUS user's role visible to whoever signs in next.
      resetProfile();
    }
  }, [authenticatedUserId]);

  if (
    i18nInstance === null ||
    onboarding.status === 'hydrating' ||
    permissionStep.status === 'hydrating' ||
    activeSession.status === 'hydrating'
  ) {
    // Blank gate until the i18n instance is ready (rendering earlier would
    // flash raw translation keys) AND every gate flag is hydrated (deciding
    // earlier would flash the wrong first screen).
    return null;
  }

  if (!onboarding.hasSeenOnboarding) {
    // Conditional render, not a navigator route: the pre-app gates are
    // one-time flows, so they never sit on the navigation stack (no back
    // gesture into them).
    return (
      <I18nProvider i18n={i18nInstance}>
        <OnboardingScreen onComplete={handleOnboardingComplete} />
      </I18nProvider>
    );
  }

  if (!permissionStep.hasHandledPermissionStep) {
    // Screen 2, after onboarding and before the rest (ARCHITECTURE.md §2
    // order: Onboarding -> Permission -> Auth/Home). Same conditional-render
    // rationale as onboarding above.
    return (
      <I18nProvider i18n={i18nInstance}>
        <PermissionPrimingScreen onHandled={handlePermissionHandled} />
      </I18nProvider>
    );
  }

  if (auth.status === 'unauthenticated') {
    // Screen 3, after both first-launch gates (ARCHITECTURE.md §2 order:
    // Onboarding -> Permission -> Auth -> Home). The screen never completes
    // itself: a successful sign-in fires SIGNED_IN, the auth store flips via
    // attachAuthStateListener, and this gate re-renders onto the navigator
    // (pinned in App.auth-gate.spec.tsx). Cold-start hydration lands as
    // INITIAL_SESSION with the persisted session, so a signed-in returning
    // user passes straight through.
    return (
      <I18nProvider i18n={i18nInstance}>
        <AuthScreen />
      </I18nProvider>
    );
  }

  if (
    activeSession.status === 'ready' &&
    activeSession.lastActiveSessionId !== null &&
    pendingWelcomeBackNavigation === null
  ) {
    // Screen 13 (ARCHITECTURE.md §2 item 13): a pre-navigator conditional
    // gate, same rationale as onboarding/permission above — it resolves
    // what the one NavigationContainer mount below should do
    // (resolveWelcomeBack, read via pendingWelcomeBackNavigation), so it
    // never sits on the navigator stack itself. Runs after auth (only a
    // signed-in user can have an interrupted session) and after the other
    // one-time gates (a first-run user can't have one either).
    return (
      <I18nProvider i18n={i18nInstance}>
        <WelcomeBackScreen sessionId={activeSession.lastActiveSessionId} />
      </I18nProvider>
    );
  }

  // Welcome Back resolves into exactly one of these two non-Home entry
  // points (or nothing, staying on Home) — React Navigation's
  // initialRouteName/initialParams are read once at this one mount, which
  // is only reached after the gate above already settled.
  const initialRouteName = pendingWelcomeBackNavigation?.screen ?? 'Home';

  return (
    <I18nProvider i18n={i18nInstance}>
      <NavigationContainer>
        {/* Header hidden: the navigator's screen name is a route id, not
            user-facing copy. */}
        <RootStack.Navigator screenOptions={{ headerShown: false }} initialRouteName={initialRouteName}>
          <RootStack.Screen name="Home" component={HomeScreen} />
          <RootStack.Screen name="History" component={HistoryScreen} />
          <RootStack.Screen name="Stats" component={StatsScreen} />
          <RootStack.Screen name="VenueManagement" component={VenueManagementScreen} />
          <RootStack.Screen name="VenueDashboard" component={VenueDashboardScreen} />
          <RootStack.Screen name="Friends" component={FriendsScreen} />
          <RootStack.Screen name="Settings" component={SettingsScreen} />
          <RootStack.Screen name="CreateSession" component={CreateSessionScreen} />
          <RootStack.Screen name="ScanSession" component={ScanSessionScreen} />
          <RootStack.Screen
            name="SessionDetails"
            component={SessionDetailsScreen}
            {...(pendingWelcomeBackNavigation?.screen === 'SessionDetails'
              ? { initialParams: { sessionId: pendingWelcomeBackNavigation.sessionId } }
              : {})}
          />
          <RootStack.Screen name="ActiveSession" component={ActiveSessionScreen} />
          <RootStack.Screen name="EmergencyExit" component={EmergencyExitScreen} />
          <RootStack.Screen
            name="SessionCompletion"
            component={SessionCompletionScreen}
            {...(pendingWelcomeBackNavigation?.screen === 'SessionCompletion'
              ? { initialParams: { sessionId: pendingWelcomeBackNavigation.sessionId } }
              : {})}
          />
        </RootStack.Navigator>
      </NavigationContainer>
    </I18nProvider>
  );
};

export default App;
