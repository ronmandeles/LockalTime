import React from 'react';
import { StyleSheet, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { fireEvent, render, screen } from '@testing-library/react-native';

import { I18nProvider } from '../i18n/I18nProvider';
import { initI18n } from '../i18n/init-i18n';
import { en } from '../i18n/locales/en';
import { he } from '../i18n/locales/he';
import { colors, sizing, typography } from '../theme/tokens';
import OnboardingScreen from './OnboardingScreen';

// Welcome screen (Screen 1), DESIGN_GUIDELINES §9: a SINGLE page — hero mark,
// headline, one line of body copy, one primary CTA pinned to the bottom. It
// replaced a three-page carousel with dots, a skip link and a Next/Get Started
// CTA; the two dropped pages' copy no longer exists in either locale bundle.
//
// Pinned contracts:
// - Completion: the screen takes an `onComplete` callback and fires it when
//   the CTA is pressed — nothing else. There is no longer any second way out,
//   so the App gate's "seen onboarding" flag is set by exactly one press. The
//   screen still never touches storage or navigation itself (App.spec.tsx owns
//   what completion means).
// - Structure: no carousel, no dots, no skip. Those testIDs must be GONE, not
//   merely unused — App.spec.tsx and the Maestro flows both reached for
//   `onboarding-skip`, and Maestro's `optional: true` would have swallowed its
//   disappearance silently.
// - Visual language, shared with Screens 2 and 3: pure-black page, centred
//   stack, and a navy gradient CTA (GradientButton, which owns the gradient
//   itself — asserted here only via its identity and sizing).
// - The hero is capped against window height rather than fixed, so a small
//   phone with OS large-font settings cannot push the CTA off-screen.
//
// RTL: styles use logical/symmetric properties and never branch on locale
// (.claude/skills/i18n/SKILL.md) — the he render below proves the copy path.
// The CTA gradient's left-to-right direction does NOT mirror under RTL (a
// gradient is paint, not layout); that is a documented manual-QA item, not a
// code branch.
//
// Determinism: no assertion depends on animations or timers; the window size
// is stubbed explicitly wherever it matters. react-native-localize is mocked
// virtually as established; no test reads the machine's real locale.

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

jest.mock(
  'react-native-localize',
  () => ({
    getLocales: () => mockGetLocales(),
  }),
  { virtual: true },
);

// The screen renders inside a SafeAreaView, whose hook throws outright
// ("No safe area value available...") without a provider above it. The
// library ships this mock for exactly that case; it must be reached through
// `.default`, since the mock module is a default export — the idiomatic
// one-liner without it fails with "useSafeAreaInsets is not a function".
// It reports all insets 0, so any assertion below sees token padding only.
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);

const renderOnboardingIn = async (
  locale: 'en' | 'he',
  onComplete: () => void = () => undefined,
): Promise<void> => {
  const i18n = await initI18n();
  await i18n.changeLanguage(locale);

  // RNTL v14 render is async (returns a Promise) — must be awaited.
  await render(
    <I18nProvider i18n={i18n}>
      <OnboardingScreen onComplete={onComplete} />
    </I18nProvider>,
  );
};

// The testID element must expose a static (flattenable) style — arrays fine,
// Pressable function-styles go on an inner element if used.
const flattenedStyle = (testID: string): ViewStyle =>
  StyleSheet.flatten(screen.getByTestId(testID).props.style as StyleProp<ViewStyle>);

const flattenedTextStyle = (text: string): TextStyle =>
  StyleSheet.flatten(screen.getByText(text).props.style as StyleProp<TextStyle>);

// DimensionValue can be a string ('50%'); the sizing contract requires plain
// numeric token values, so anything else is itself a failure.
const asNumber = (value: unknown): number => {
  if (typeof value !== 'number') {
    throw new Error(`expected a numeric style value, got: ${String(value)}`);
  }
  return value;
};

describe('OnboardingScreen', () => {
  beforeEach(() => {
    mockGetLocales.mockReset();
    mockGetLocales.mockReturnValue([EN_US]);
  });

  describe('copy', () => {
    it('renders the single welcome title and body from the en locale module', async () => {
      await renderOnboardingIn('en');

      expect(screen.getByText(en.onboarding.title)).toBeOnTheScreen();
      expect(screen.getByText(en.onboarding.body)).toBeOnTheScreen();
      expect(screen.getByText(en.onboarding.getStarted)).toBeOnTheScreen();
    });

    it('renders the Hebrew copy under the he locale, proving the screen flows through i18n', async () => {
      // Guard: identical bundles would let a hardcoded literal pass below.
      const enTitle = en.onboarding.title;
      const heTitle = he.onboarding.title;
      expect(heTitle).not.toBe(enTitle);

      await renderOnboardingIn('he');

      expect(screen.getByText(heTitle)).toBeOnTheScreen();
      expect(screen.queryByText(enTitle)).toBeNull();
    });

    it('exposes the screen root under the testID the App gate looks for', async () => {
      await renderOnboardingIn('en');

      expect(screen.getByTestId('onboarding-screen')).toBeOnTheScreen();
    });
  });

  describe('single-page structure', () => {
    it('has no carousel, no pagination dots, and no skip affordance', async () => {
      await renderOnboardingIn('en');

      expect(screen.queryByTestId('onboarding-carousel')).toBeNull();
      expect(screen.queryByTestId('onboarding-skip')).toBeNull();
      [0, 1, 2].forEach((pageIndex) => {
        expect(screen.queryByTestId(`onboarding-page-dot-${pageIndex}`)).toBeNull();
      });
    });

    it('renders the hero ring mark above the copy', async () => {
      await renderOnboardingIn('en');

      expect(screen.getByTestId('onboarding-hero-logo')).toBeOnTheScreen();
    });
  });

  describe('primary CTA', () => {
    it('is labelled Get Started — there is no Next step left to take', async () => {
      await renderOnboardingIn('en');

      expect(screen.getByTestId('onboarding-primary-cta')).toBeOnTheScreen();
      expect(screen.getByText(en.onboarding.getStarted)).toBeOnTheScreen();
    });

    it('fires onComplete exactly once when pressed — the only way off this screen', async () => {
      const onComplete = jest.fn<void, []>();
      await renderOnboardingIn('en', onComplete);

      await fireEvent.press(screen.getByTestId('onboarding-primary-cta'));

      expect(onComplete).toHaveBeenCalledTimes(1);
    });
  });

  describe('visual language (DESIGN_GUIDELINES §6, §12)', () => {
    it('fills the page with the background token', async () => {
      await renderOnboardingIn('en');

      expect(flattenedStyle('onboarding-screen').backgroundColor).toBe(colors.background);
    });

    it('sizes the primary CTA to the button-height token', async () => {
      await renderOnboardingIn('en');

      expect(flattenedStyle('onboarding-primary-cta').height).toBe(sizing.buttonHeight);
    });

    it('sets the title and body to the display-large and muted-body tokens', async () => {
      await renderOnboardingIn('en');

      const title = flattenedTextStyle(en.onboarding.title);
      expect(title.fontSize).toBe(typography.displayLarge.fontSize);
      expect(title.color).toBe(colors.textPrimary);
      expect(title.textAlign).toBe('center');

      const body = flattenedTextStyle(en.onboarding.body);
      expect(body.fontSize).toBe(typography.body.fontSize);
      expect(body.color).toBe(colors.textMuted);
      expect(body.textAlign).toBe('center');
    });
  });

  describe('small-screen resilience', () => {
    // The reference design is a 393x852pt phone. On a 320x568pt one, a hero
    // fixed at the 160pt token plus large OS font settings can push the
    // bottom-pinned CTA off-screen. A ScrollView would fight the pinned CTA,
    // so the hero is what gives.
    const renderAtWindowHeight = async (height: number): Promise<void> => {
      jest
        .spyOn(require('react-native'), 'useWindowDimensions')
        .mockReturnValue({ width: 320, height, scale: 2, fontScale: 1 });
      await renderOnboardingIn('en');
    };

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('caps the hero at the sizing token on a roomy screen', async () => {
      await renderAtWindowHeight(852);

      expect(flattenedStyle('onboarding-hero-logo').width).toBe(sizing.heroLogo);
    });

    it('shrinks the hero below the token on a short screen, keeping it circular', async () => {
      await renderAtWindowHeight(568);

      const hero = flattenedStyle('onboarding-hero-logo');
      const width = asNumber(hero.width);
      expect(width).toBeLessThan(sizing.heroLogo);
      expect(width).toBeGreaterThan(0);
      // A shrunk ellipse would be worse than a small circle.
      expect(hero.height).toBe(width);
    });
  });
});
