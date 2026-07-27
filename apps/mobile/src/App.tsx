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
import HomeScreen from './screens/HomeScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import PermissionPrimingScreen from './screens/PermissionPrimingScreen';
import ScanSessionScreen from './screens/ScanSessionScreen';
import SessionDetailsScreen from './screens/SessionDetailsScreen';
import { attachAuthStateListener, useAuthStore } from './state/auth-store';
import { hydrateOnboardingStatus, markOnboardingSeen, useOnboardingStore } from './state/onboarding-store';
import {
  hydratePermissionStepStatus,
  markPermissionStepHandled,
  usePermissionStore,
} from './state/permission-store';

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

  if (
    i18nInstance === null ||
    onboarding.status === 'hydrating' ||
    permissionStep.status === 'hydrating'
  ) {
    // Blank gate until the i18n instance is ready (rendering earlier would
    // flash raw translation keys) AND both gate flags are hydrated (deciding
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

  return (
    <I18nProvider i18n={i18nInstance}>
      <NavigationContainer>
        {/* Header hidden: the navigator's screen name is a route id, not
            user-facing copy. */}
        <RootStack.Navigator screenOptions={{ headerShown: false }}>
          <RootStack.Screen name="Home" component={HomeScreen} />
          <RootStack.Screen name="CreateSession" component={CreateSessionScreen} />
          <RootStack.Screen name="ScanSession" component={ScanSessionScreen} />
          <RootStack.Screen name="SessionDetails" component={SessionDetailsScreen} />
          <RootStack.Screen name="ActiveSession" component={ActiveSessionScreen} />
        </RootStack.Navigator>
      </NavigationContainer>
    </I18nProvider>
  );
};

export default App;
