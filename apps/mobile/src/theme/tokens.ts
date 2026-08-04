// Design tokens mirroring docs/DESIGN_GUIDELINES.md — §2 spacing scale, §3
// corner radius scale, §5 typography ramp (1.4x line height, no exceptions),
// §6 component sizing standards, §12 color palette. Screens style from
// these tokens only, never ad-hoc values (tokens.test.ts locks the values).

const LINE_HEIGHT_RATIO = 1.4;

// The palette (§12) — pure black with a navy-blue accent
// (docs/NAVY_THEME_PLAN.md). Every token keeps the name and semantic role it
// had under the previous light teal palette; only the values changed. That is
// what let the whole app repaint in one file: no screen holds a hex literal,
// so every one of them followed these values into dark mode without an edit.
// Contrast ratios for every token are asserted in tokens.test.ts rather than
// only documented — a value nudged below WCAG AA fails the suite.
export const colors = {
  // Surfaces — neutral greys on true black, so the accent carries all the
  // color (matching the reference design's restraint).
  background: '#000000',
  surface: '#1C1C1E',
  surfaceActive: '#2C2C2E',
  border: '#2C2C2E',
  borderStrong: '#3A3A3C',
  // Camera viewfinder letterboxing only — true black is a technical
  // necessity there, not part of the semantic surface scale. It now happens
  // to equal `background`; the two roles stay separate regardless.
  black: '#000000',

  // Text (brightest to faintest emphasis — inverted from the light palette)
  textPrimary: '#FFFFFF',
  textSecondary: '#C7C7CC',
  textMuted: '#8D8D92',
  textFaint: '#86868C',
  placeholder: '#8A8A8F',

  // Brand accent — navy blue, deliberately brightened from a true navy
  // (#1B2A6B family): on black, a true navy is too low-contrast to be
  // usable as a button fill. Used for CTAs, selected/active states, and
  // progress fills — never for plain body text.
  primary: '#3563D8',
  primaryPressed: '#2A50BC',
  // The CTA gradient's two ends, squeezed from both sides: dark enough to
  // keep the white label at 4.5:1, light enough to keep the button's edge
  // perceivable against black at 3:1 (WCAG 1.4.11).
  primaryGradientStart: '#2F5BD0',
  primaryGradientEnd: '#3B6FE0',
  // Icon-badge fill: the accent at ~12% over black.
  primarySubtle: '#0C1428',
  onPrimary: '#FFFFFF',

  // Semantic (§11's original deferred list: "success/warning colors") —
  // lightened for the dark surface; the old dark values (#B00020 etc.) are
  // unreadable on black.
  danger: '#FF6B7A',
  warning: '#F0A34A',
  success: '#4ADE80',

  // Dialog/overlay scrim
  overlay: '#000000CC',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  '2xl': 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  full: 9999,
} as const;

// Weights as RN numeric strings: '700' Bold, '600' Semibold, '400' Regular.
// Typeface stays the OS system font (§5) — no fontFamily token needed.
export const typography = {
  // The onboarding welcome headline only — one step above `display`, which
  // stays the largest size any in-app screen uses.
  displayLarge: { fontSize: 34, fontWeight: '700', lineHeight: 34 * LINE_HEIGHT_RATIO },
  display: { fontSize: 28, fontWeight: '700', lineHeight: 28 * LINE_HEIGHT_RATIO },
  heading: { fontSize: 20, fontWeight: '600', lineHeight: 20 * LINE_HEIGHT_RATIO },
  body: { fontSize: 16, fontWeight: '400', lineHeight: 16 * LINE_HEIGHT_RATIO },
  bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: 16 * LINE_HEIGHT_RATIO },
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 13 * LINE_HEIGHT_RATIO },
} as const;

export const sizing = {
  // The stricter of iOS 44pt / Android 48dp, applied everywhere (§6).
  minTouchTarget: 48,
  buttonHeight: 52,
  inputHeight: 48,
  iconStandard: 24,
  iconLarge: 28,
  avatarParticipant: 36,
  // Onboarding-flow hero geometry: the Screen 1 ring mark, and the Screen 2
  // tinted circle the same mark sits inside at roughly half scale.
  heroLogo: 160,
  iconBadge: 100,
} as const;
