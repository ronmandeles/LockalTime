// Design tokens mirroring docs/DESIGN_GUIDELINES.md — §2 spacing scale, §3
// corner radius scale, §5 typography ramp (1.4x line height, no exceptions),
// §6 component sizing standards, §12 color palette. Screens style from
// these tokens only, never ad-hoc values (tokens.test.ts locks the values).

const LINE_HEIGHT_RATIO = 1.4;

// Phase 7 (Release Prep) — the real palette (§12), replacing every screen's
// ad-hoc neutral-grayscale literal. Two roles per color: a formal name for
// what had drifted into several near-duplicate grays across screens picked
// independently before this token existed (textSecondary/textMuted/textFaint
// were '#444444'/'#666666'/'#999999' in different files for the same
// "de-emphasized text" intent), and one new real accent (`primary`) for
// every element that means "the active/selected/primary thing here" —
// previously flat neutral (`#222222`, indistinguishable from body text).
export const colors = {
  // Surfaces
  background: '#FFFFFF',
  surface: '#F5F5F5',
  surfaceActive: '#DDDDDD',
  border: '#E0E0E0',
  borderStrong: '#CCCCCC',
  // Camera viewfinder letterboxing only — true black is a technical
  // necessity there, not part of the semantic surface scale.
  black: '#000000',

  // Text (darkest to lightest emphasis)
  textPrimary: '#222222',
  textSecondary: '#444444',
  textMuted: '#666666',
  textFaint: '#999999',
  placeholder: '#888888',

  // Brand accent — a calm, focused teal (this is a distraction-blocking/
  // wellbeing app, not a game; the accent should read as grounded, not
  // stimulating). Used for primary CTAs, selected/active states, and
  // progress fills — never for plain body text.
  primary: '#0F6B5C',
  primaryPressed: '#0B554A',
  onPrimary: '#FFFFFF',

  // Semantic (§11's original deferred list: "success/warning colors")
  danger: '#B00020',
  warning: '#B25E09',
  success: '#1E8E3E',

  // Dialog/overlay scrim
  overlay: '#44444488',
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
} as const;
