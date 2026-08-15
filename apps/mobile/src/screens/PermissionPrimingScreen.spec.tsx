import React from 'react';
import {
  AppState,
  Linking,
  StyleSheet,
  type AppStateEvent,
  type AppStateStatus,
  type NativeEventSubscription,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import { sizing } from '../theme/tokens';
import PermissionPrimingScreen from './PermissionPrimingScreen';

// Permission-priming screen (Screen 2), DESIGN_GUIDELINES §9: one screen
// resolving one hesitation — why the blocking permission is needed — with a
// single primary CTA per state (§1). Placeholder en+he copy, flagged for the
// deferred copy pass.
//
// Pinned contracts:
// - Priming state: title + body + one Allow CTA. Pressing Allow calls
//   blockingPermissions.request() — the screen never talks to a native bridge
//   itself, only to the service contract (Phase 3 swaps the service's
//   internals, never this screen; .claude/skills/testing-standards/SKILL.md native-modules
//   rule).
// - Result handling, keyed off the discriminated status: 'granted' fires
//   onHandled; 'denied' switches to the fallback state; 'undetermined' (a
//   Settings screen is now open) leaves the priming state intact — the CTA
//   stays available, and the foreground-return listener drives the next step.
// - CHAINED ROUND-TRIP — one Allow tap, not one per permission. Android needs
//   two separate special-access grants (Usage Access, then Overlay), each in
//   its own Settings screen, with no combined screen to send the user to. So
//   on foreground return mid-flow the screen re-drives request() itself
//   instead of waiting for a second Allow press. Loop safety lives in the
//   native module, which only advances when the permission it just asked for
//   actually became granted: a user who backs out without granting gets
//   'denied' and the recovery state, never a relaunch they cannot escape.
// - DENIED FALLBACK (the backlog item's second half): explanatory copy, an
//   open-settings affordance (Linking.openSettings, the sole OS touchpoint,
//   spied here) that keeps the user on the screen for a return-and-retry, and
//   a proceed-anyway affordance that fires onHandled. Reasoning for
//   proceed-anyway existing at all (flagged for review): ARCHITECTURE.md §2
//   lists "permission-denied fallback" as a recovery surface, and §8's
//   posture (item 8: integrity failures "never block Solo Mode or general
//   usage") is fail-open for capability shortfalls — the app is a commitment
//   device, not a jail, and the permission is only exercised when a session
//   starts. A hard wall would also brick every Phase 1 build outright, since
//   the placeholder service can only ever answer 'denied'. Session start in
//   Phase 3 re-checks live status via getStatus(); proceeding here never
//   fakes a grant.
// - Like OnboardingScreen, the screen is storage-agnostic: it only fires
//   onHandled; the App gate owns persistence (permission-store) and what
//   handling means.
// - Token sizing: primary CTAs (Allow; the fallback's open-settings) are
//   buttonHeight (52); proceed-anyway declares the minTouchTarget minimum
//   (48). Tokens, never ad-hoc values.
//
// RTL: styles use logical properties and never branch on locale
// (.claude/skills/i18n/SKILL.md); the he renders below prove both states' copy flows
// through i18n. Real OS dialogs/settings round-trips are not JS-testable and
// live on the manual QA checklist when the native module lands (Phase 3).
// react-native-localize and the blocking-permissions service are both mocked
// normally: BOTH modules really exist, and `{ virtual: true }` on a module
// that resolves for real makes jest's choice between mock and real
// non-deterministic across workers (it made this suite flaky). No test
// touches a real locale, bridge, or the OS settings app.

interface DeviceLocaleStub {
  readonly countryCode: string;
  readonly isRTL: boolean;
  readonly languageCode: string;
  readonly languageTag: string;
}

const EN_US: DeviceLocaleStub = {
  countryCode: 'US',
  isRTL: false,
  languageCode: 'en',
  languageTag: 'en-US',
};

const mockGetLocales = jest.fn<DeviceLocaleStub[], []>();

jest.mock('react-native-localize', () => ({
  getLocales: () => mockGetLocales(),
}));

interface PermissionStatusStub {
  readonly status: 'granted' | 'denied' | 'undetermined';
}

const mockGetStatus = jest.fn<Promise<PermissionStatusStub>, []>();
const mockRequest = jest.fn<Promise<PermissionStatusStub>, []>();
const mockRequestBatteryOptimizationExemption = jest.fn<Promise<void>, []>();

// Mocking the service module pins that the screen goes through the contract
// surface — an implementation reaching for a native module (or the placeholder
// directly) fails these tests. getStatus is stubbed but unasserted: the App
// gate keys off the persisted handled flag in Phase 1, not live status, but
// an implementation consulting it must not break.
jest.mock('../services/blocking-permissions', () => ({
  blockingPermissions: {
    getStatus: () => mockGetStatus(),
    request: () => mockRequest(),
  },
  requestBatteryOptimizationExemption: () => mockRequestBatteryOptimizationExemption(),
}));

// The screen renders inside a SafeAreaView, whose hook throws outright
// ("No safe area value available...") without a provider above it. Reached
// through `.default` because the shipped mock module is a default export —
// the idiomatic one-liner without it fails with "useSafeAreaInsets is not a
// function". It reports all insets 0, so assertions see token padding only.
jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

const renderPermissionPrimingIn = async (
  locale: 'en' | 'he',
  onHandled: () => void = () => undefined,
): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);

  // RNTL v14 render is async (returns a Promise) — must be awaited.
  await render(
    <I18nProvider i18n={i18n}>
      <PermissionPrimingScreen onHandled={onHandled} />
    </I18nProvider>,
  );
};

const pressAllow = async (): Promise<void> => {
  await fireEvent.press(screen.getByTestId('permission-allow-cta'));
};

// Drives the screen into the denied fallback; findBy* awaits the state flip
// after the mocked request settles.
const driveToDeniedFallback = async (): Promise<void> => {
  mockRequest.mockResolvedValue({ status: 'denied' });
  await pressAllow();
  await screen.findByTestId('permission-open-settings-cta');
};

// Leaves the screen mid-flow: Allow pressed once, a Settings screen open,
// nothing granted yet. Awaiting the call settles request()'s .then, so the
// screen has recorded the in-flight trip before a foreground return fires.
const pressAllowAndLandInSettings = async (): Promise<void> => {
  mockRequest.mockResolvedValue({ status: 'undetermined' });
  await pressAllow();
  await waitFor(() => {
    expect(mockRequest).toHaveBeenCalledTimes(1);
  });
};

// The testID element must expose a static (flattenable) style — arrays fine,
// Pressable function-styles go on an inner element if used.
const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

// DimensionValue can be a string ('50%'); the sizing contract requires plain
// numeric token values, so anything else is itself a failure.
const asNumber = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new Error(`expected a numeric style value, got: ${String(value)}`);
  }
  return value;
};

describe('PermissionPrimingScreen', () => {
  let openSettingsSpy: jest.SpyInstance<Promise<void>, []>;
  let addEventListenerSpy: jest.SpyInstance<
    NativeEventSubscription,
    [type: AppStateEvent, listener: (state: AppStateStatus) => void]
  >;

  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
    mockGetStatus.mockReset();
    mockGetStatus.mockResolvedValue({ status: 'undetermined' });
    mockRequest.mockReset();
    mockRequest.mockResolvedValue({ status: 'undetermined' });
    mockRequestBatteryOptimizationExemption.mockReset();
    mockRequestBatteryOptimizationExemption.mockResolvedValue(undefined);
    // Linking is the one OS touchpoint; spied so no test opens real settings.
    openSettingsSpy = jest.spyOn(Linking, 'openSettings').mockImplementation(async () => undefined);
    addEventListenerSpy = jest.spyOn(AppState, 'addEventListener');
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The screen's AppState 'change' subscription is the only foreground-return
  // recheck mechanism (Usage Access/Overlay grants happen in a Settings
  // screen the app never gets a direct callback from). Finds the *most
  // recently registered* listener and fires it, simulating the OS resuming
  // the app to 'active' — the spy's call history isn't guaranteed to be
  // empty at the start of a test (RN's AppState mock doesn't fully reset via
  // jest.restoreAllMocks() between tests), so the last registration is
  // always the current test's own render, never an earlier one's.
  const simulateAppBecameActive = async (): Promise<void> => {
    const calls = addEventListenerSpy.mock.calls.filter(([eventName]) => eventName === 'change');
    const call = calls.at(-1);
    if (call === undefined) {
      throw new Error('component did not register an AppState "change" listener');
    }
    const listener = call[1];
    await act(async () => {
      listener('active');
    });
  };

  describe('priming state', () => {
    it('renders the priming title, body, and Allow CTA from the en locale module', async () => {
      await renderPermissionPrimingIn('en');

      expect(screen.getByText(en.permissionPriming.title)).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.body)).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.allow)).toBeOnTheScreen();
    });

    it('renders the Hebrew priming copy under the he locale, proving the screen flows through i18n', async () => {
      // Guard: identical bundles would let a hardcoded literal pass below.
      const enTitle = en.permissionPriming.title;
      const heTitle = he.permissionPriming.title;
      expect(heTitle).not.toBe(enTitle);

      await renderPermissionPrimingIn('he');

      expect(screen.getByText(heTitle)).toBeOnTheScreen();
      expect(screen.queryByText(enTitle)).toBeNull();
    });

    it('exposes the screen root under the testID the App gate looks for', async () => {
      await renderPermissionPrimingIn('en');

      expect(screen.getByTestId('permission-priming-screen')).toBeOnTheScreen();
    });

    it('shows no fallback affordances while priming — one primary action per state', async () => {
      await renderPermissionPrimingIn('en');

      expect(screen.queryByTestId('permission-open-settings-cta')).toBeNull();
      expect(screen.queryByTestId('permission-proceed-anyway')).toBeNull();
    });

    it('renders the tinted icon badge above the copy', async () => {
      await renderPermissionPrimingIn('en');

      expect(screen.getByTestId('permission-icon-badge')).toBeOnTheScreen();
    });

    it('requests the blocking permission through the service when Allow is pressed', async () => {
      await renderPermissionPrimingIn('en');

      await pressAllow();

      expect(mockRequest).toHaveBeenCalledTimes(1);
    });
  });

  // THE ONE DELIBERATE BEHAVIOUR CHANGE in the theme restyle, decided by the
  // owner with the trade-off stated: the escape hatch now appears during
  // priming, not only after a real refusal, matching the reference design.
  //
  // The cost was accepted knowingly and is worth restating here, because a
  // future reader will be tempted to "fix" it: more users will reach Home
  // without ever attempting the screen-time permission, and blocking does not
  // function without it — so they land in a working app whose core feature
  // silently does nothing. The recovery path still exists (the permission is
  // re-requestable later). Do not quietly restore the old behaviour.
  //
  // It is a SEPARATE affordance from the denied state's proceed-anyway: its
  // own testID and its own locale key, because the two links live in
  // different states and their copy should be free to diverge.
  describe('maybe-later escape hatch (priming state)', () => {
    it('offers maybe-later alongside Allow, with its own en copy', async () => {
      await renderPermissionPrimingIn('en');

      expect(screen.getByTestId('permission-maybe-later')).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.maybeLater)).toBeOnTheScreen();
    });

    it('renders the Hebrew maybe-later copy under the he locale', async () => {
      const enLabel = en.permissionPriming.maybeLater;
      const heLabel = he.permissionPriming.maybeLater;
      expect(heLabel).not.toBe(enLabel);

      await renderPermissionPrimingIn('he');

      expect(screen.getByText(heLabel)).toBeOnTheScreen();
      expect(screen.queryByText(enLabel)).toBeNull();
    });

    it('fires onHandled once when pressed, without ever asking for the permission', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);

      await fireEvent.press(screen.getByTestId('permission-maybe-later'));

      expect(onHandled).toHaveBeenCalledTimes(1);
      // Skipping is not a denial: the OS is never consulted, so no state
      // flip and no battery-optimization ask follow.
      expect(mockRequest).not.toHaveBeenCalled();
      expect(mockRequestBatteryOptimizationExemption).not.toHaveBeenCalled();
    });

    it("is a distinct affordance from the denied state's proceed-anyway", async () => {
      await renderPermissionPrimingIn('en');
      expect(screen.queryByTestId('permission-proceed-anyway')).toBeNull();

      await driveToDeniedFallback();

      // The denied state keeps its own link, unchanged, and does not carry
      // the priming one — one escape hatch visible per state.
      expect(screen.getByTestId('permission-proceed-anyway')).toBeOnTheScreen();
      expect(screen.queryByTestId('permission-maybe-later')).toBeNull();
    });

    it('declares the minimum touch target', async () => {
      await renderPermissionPrimingIn('en');

      const style = flattenedStyle('permission-maybe-later');
      expect(asNumber(style.minHeight)).toBeGreaterThanOrEqual(sizing.minTouchTarget);
      expect(asNumber(style.minWidth)).toBeGreaterThanOrEqual(sizing.minTouchTarget);
    });
  });

  describe('granted result', () => {
    it('fires onHandled once when the request resolves granted', async () => {
      const onHandled = jest.fn<void, []>();
      mockRequest.mockResolvedValue({ status: 'granted' });
      await renderPermissionPrimingIn('en', onHandled);

      await pressAllow();

      await waitFor(() => {
        expect(onHandled).toHaveBeenCalledTimes(1);
      });
      expect(screen.queryByTestId('permission-open-settings-cta')).toBeNull();
    });

    it('fires the battery-optimization exemption ask as a side effect of a real grant', async () => {
      mockRequest.mockResolvedValue({ status: 'granted' });
      await renderPermissionPrimingIn('en');

      await pressAllow();

      await waitFor(() => {
        expect(mockRequestBatteryOptimizationExemption).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('undetermined result', () => {
    it('stays in the priming state, leaving Allow available for a retry', async () => {
      const onHandled = jest.fn<void, []>();
      mockRequest.mockResolvedValue({ status: 'undetermined' });
      await renderPermissionPrimingIn('en', onHandled);

      await pressAllow();

      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(1);
      });
      expect(onHandled).not.toHaveBeenCalled();
      expect(screen.getByTestId('permission-allow-cta')).toBeOnTheScreen();
      expect(screen.queryByTestId('permission-open-settings-cta')).toBeNull();
    });
  });

  describe('denied fallback state', () => {
    it('switches to the fallback with its en copy when the request resolves denied', async () => {
      await renderPermissionPrimingIn('en');

      await driveToDeniedFallback();

      expect(screen.getByText(en.permissionPriming.denied.title)).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.denied.body)).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.denied.openSettings)).toBeOnTheScreen();
      expect(screen.getByText(en.permissionPriming.denied.proceedAnyway)).toBeOnTheScreen();
      // One primary action per state: the Allow CTA belongs to priming only.
      expect(screen.queryByTestId('permission-allow-cta')).toBeNull();
    });

    it('does not fire onHandled on denial — denial is a recovery state, not completion', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);

      await driveToDeniedFallback();

      expect(onHandled).not.toHaveBeenCalled();
    });

    it('renders the Hebrew fallback copy under the he locale', async () => {
      const enDeniedTitle = en.permissionPriming.denied.title;
      const heDeniedTitle = he.permissionPriming.denied.title;
      expect(heDeniedTitle).not.toBe(enDeniedTitle);

      await renderPermissionPrimingIn('he');

      await driveToDeniedFallback();

      expect(screen.getByText(heDeniedTitle)).toBeOnTheScreen();
      expect(screen.queryByText(enDeniedTitle)).toBeNull();
    });

    it('opens the OS settings via Linking when open-settings is pressed, staying on the screen', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await driveToDeniedFallback();

      await fireEvent.press(screen.getByTestId('permission-open-settings-cta'));

      expect(openSettingsSpy).toHaveBeenCalledTimes(1);
      // Recovery, not completion: the user returns from settings to retry.
      expect(onHandled).not.toHaveBeenCalled();
      expect(screen.getByTestId('permission-open-settings-cta')).toBeOnTheScreen();
    });

    it('fires onHandled once when proceed-anyway is pressed, so denial never hard-walls the app', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await driveToDeniedFallback();

      await fireEvent.press(screen.getByTestId('permission-proceed-anyway'));

      expect(onHandled).toHaveBeenCalledTimes(1);
    });
  });

  describe('foreground-return recheck (Phase 3 task 3.2)', () => {
    // Usage Access / Overlay grants happen in a Settings screen the app
    // never gets a direct callback from — this is the only path back to
    // 'granted' after "open settings", so it must actually work.
    it('re-checks status and fires onHandled when the app returns to active and is now granted', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await driveToDeniedFallback();

      mockGetStatus.mockResolvedValue({ status: 'granted' });
      await simulateAppBecameActive();

      await waitFor(() => expect(onHandled).toHaveBeenCalledTimes(1));
      expect(mockRequestBatteryOptimizationExemption).toHaveBeenCalledTimes(1);
    });

    it('stays on the denied screen if the recheck still reports denied', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await driveToDeniedFallback();

      mockGetStatus.mockResolvedValue({ status: 'denied' });
      await simulateAppBecameActive();

      expect(onHandled).not.toHaveBeenCalled();
      expect(screen.getByTestId('permission-open-settings-cta')).toBeOnTheScreen();
    });

    it('does not recheck while still in the priming state — nothing to recover from yet', async () => {
      await renderPermissionPrimingIn('en');

      mockGetStatus.mockResolvedValue({ status: 'granted' });
      await simulateAppBecameActive();

      expect(mockGetStatus).not.toHaveBeenCalled();
    });
  });

  // Android needs TWO special-access grants (Usage Access, then Overlay), each
  // in its own Settings screen, and offers no combined screen and no runtime
  // dialog for either. Before this, request() opened the first screen and the
  // user had to press Allow a second time to reach the other — two taps for
  // one decision. Now one tap drives the whole sequence: 'undetermined' means
  // a Settings screen is open, and the foreground return re-drives request().
  //
  // The dangerous failure mode here is a relaunch loop — return to the app,
  // get thrown straight back into Settings, forever, with no way out. The
  // guard is that the screen only ever re-asks; the native module decides
  // whether to actually launch anything, and answers 'denied' when the
  // permission it last asked for is still not granted. These tests pin the
  // screen's half: it re-drives only mid-flow, and honours a 'denied' answer
  // by stopping.
  describe('chained permission round-trip (one Allow tap)', () => {
    it('re-drives the request on foreground return, opening the next permission screen', async () => {
      await renderPermissionPrimingIn('en');
      await pressAllowAndLandInSettings();

      await simulateAppBecameActive();

      await waitFor(() => {
        expect(mockRequest).toHaveBeenCalledTimes(2);
      });
    });

    it('completes on a single Allow press once the chained request resolves granted', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await pressAllowAndLandInSettings();

      // The second Settings screen was granted: the chained call now answers
      // for the whole capability, with no further user action on this screen.
      mockRequest.mockResolvedValue({ status: 'granted' });
      await simulateAppBecameActive();

      await waitFor(() => {
        expect(onHandled).toHaveBeenCalledTimes(1);
      });
      expect(mockRequestBatteryOptimizationExemption).toHaveBeenCalledTimes(1);
    });

    it('lands in the recovery state when the chained request reports no progress', async () => {
      const onHandled = jest.fn<void, []>();
      await renderPermissionPrimingIn('en', onHandled);
      await pressAllowAndLandInSettings();

      // The user came back without granting, so the native module refuses to
      // relaunch and answers denied — the recovery state, not another trip.
      mockRequest.mockResolvedValue({ status: 'denied' });
      await simulateAppBecameActive();

      await screen.findByTestId('permission-open-settings-cta');
      expect(onHandled).not.toHaveBeenCalled();
    });

    it('does not re-drive the request when Allow was never pressed', async () => {
      await renderPermissionPrimingIn('en');

      await simulateAppBecameActive();

      expect(mockRequest).not.toHaveBeenCalled();
    });

    it('stops re-driving once the flow has ended in the recovery state', async () => {
      await renderPermissionPrimingIn('en');
      await driveToDeniedFallback();

      mockGetStatus.mockResolvedValue({ status: 'denied' });
      await simulateAppBecameActive();

      // The denied state recovers through getStatus() and the user's own
      // open-settings press — never by reopening Settings unprompted.
      expect(mockRequest).toHaveBeenCalledTimes(1);
      expect(mockGetStatus).toHaveBeenCalledTimes(1);
    });
  });

  describe('token sizing (DESIGN_GUIDELINES §6)', () => {
    it('sizes the Allow CTA to the button-height token', async () => {
      await renderPermissionPrimingIn('en');

      expect(flattenedStyle('permission-allow-cta').height).toBe(sizing.buttonHeight);
    });

    it("sizes the fallback's open-settings CTA to the button-height token", async () => {
      await renderPermissionPrimingIn('en');

      await driveToDeniedFallback();

      expect(flattenedStyle('permission-open-settings-cta').height).toBe(sizing.buttonHeight);
    });

    it('declares the minimum touch target on the proceed-anyway affordance', async () => {
      await renderPermissionPrimingIn('en');

      await driveToDeniedFallback();

      const proceedStyle = flattenedStyle('permission-proceed-anyway');
      expect(asNumber(proceedStyle.minHeight)).toBeGreaterThanOrEqual(sizing.minTouchTarget);
      expect(asNumber(proceedStyle.minWidth)).toBeGreaterThanOrEqual(sizing.minTouchTarget);
    });
  });
});
