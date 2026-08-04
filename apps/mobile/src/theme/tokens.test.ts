import { colors, radius, sizing, spacing, typography } from './tokens';

// Locks the numeric design language of docs/DESIGN_GUIDELINES.md into
// executable form: §2 spacing scale, §3 radius scale, §5 typography ramp with
// the 1.4x line-height rule, §6 component sizing standards, §12 color
// palette. Screens consume these tokens instead of ad-hoc values; any drift
// from the guideline numbers fails here. Whole-object toEqual assertions
// double as completeness checks — a token silently added, removed, or
// renamed outside the documented scale fails the exact-shape match.
// Deliberately absent: the elevation scale (§4's "subtle shadow" definition
// hasn't been needed by any screen yet — added when the first elevation-1
// component lands).

describe('spacing scale (DESIGN_GUIDELINES §2)', () => {
  it('matches the documented six-step scale exactly, with no extra or missing steps', () => {
    expect(spacing).toEqual({
      xs: 4,
      sm: 8,
      md: 16,
      lg: 24,
      xl: 32,
      '2xl': 48,
    });
  });
});

describe('radius scale (DESIGN_GUIDELINES §3)', () => {
  it('matches the documented curve language exactly, with no extra or missing steps', () => {
    expect(radius).toEqual({
      sm: 8,
      md: 12,
      lg: 16,
      xl: 24,
      full: 9999,
    });
  });
});

describe('typography ramp (DESIGN_GUIDELINES §5)', () => {
  it('matches the documented ramp: five tokens with the documented sizes and weights', () => {
    // Weights pinned as RN numeric strings: '700' Bold, '600' Semibold,
    // '400' Regular — unambiguous across both platforms.
    expect(typography).toEqual({
      displayLarge: { fontSize: 34, fontWeight: '700', lineHeight: expect.any(Number) },
      display: { fontSize: 28, fontWeight: '700', lineHeight: expect.any(Number) },
      heading: { fontSize: 20, fontWeight: '600', lineHeight: expect.any(Number) },
      body: { fontSize: 16, fontWeight: '400', lineHeight: expect.any(Number) },
      bodyStrong: { fontSize: 16, fontWeight: '600', lineHeight: expect.any(Number) },
      caption: { fontSize: 13, fontWeight: '400', lineHeight: expect.any(Number) },
    });
  });

  it('uses a 1.4x line height on every token, no exceptions', () => {
    // Explicit property access (not Object.entries) keeps each token fully
    // typed; the exact-shape assertion above already guards the key set.
    const ramp = [
      typography.displayLarge,
      typography.display,
      typography.heading,
      typography.body,
      typography.bodyStrong,
      typography.caption,
    ];

    ramp.forEach((token) => {
      // toBeCloseTo tolerates float representation of the same ratio (e.g. a
      // hardcoded 39.2 vs a computed 28 * 1.4) while still failing any other
      // ratio.
      expect(token.lineHeight).toBeCloseTo(token.fontSize * 1.4, 5);
    });
  });
});

describe('component sizing standards (DESIGN_GUIDELINES §6)', () => {
  it('matches the documented sizing table exactly', () => {
    expect(sizing).toEqual({
      // 48 is the stricter of iOS 44pt / Android 48dp, applied everywhere.
      minTouchTarget: 48,
      buttonHeight: 52,
      inputHeight: 48,
      iconStandard: 24,
      iconLarge: 28,
      avatarParticipant: 36,
      // Onboarding-flow hero geometry (NAVY_THEME_PLAN §4): the Screen 1
      // ring mark and the Screen 2 tinted icon badge.
      heroLogo: 160,
      iconBadge: 100,
    });
  });
});

describe('color palette (DESIGN_GUIDELINES §12)', () => {
  it('matches the documented palette exactly', () => {
    expect(colors).toEqual({
      background: '#000000',
      surface: '#1C1C1E',
      surfaceActive: '#2C2C2E',
      border: '#2C2C2E',
      borderStrong: '#3A3A3C',
      black: '#000000',
      textPrimary: '#FFFFFF',
      textSecondary: '#C7C7CC',
      textMuted: '#8D8D92',
      textFaint: '#86868C',
      placeholder: '#8A8A8F',
      primary: '#3563D8',
      primaryPressed: '#2A50BC',
      primaryGradientStart: '#2F5BD0',
      primaryGradientEnd: '#3B6FE0',
      primarySubtle: '#0C1428',
      onPrimary: '#FFFFFF',
      link: '#5B8AF0',
      danger: '#FF6B7A',
      warning: '#F0A34A',
      success: '#4ADE80',
      overlay: '#000000CC',
    });
  });

  // The palette is only usable if it is legible: a dark repaint that silently
  // drops a token below WCAG AA is exactly the regression the §12 contrast
  // table exists to prevent, so the ratios are computed here rather than
  // trusted to a doc. Formula: WCAG 2.x relative luminance + contrast ratio.
  const relativeLuminance = (hex: string): number => {
    const channel = (offset: number): number => {
      const srgb = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
  };

  const contrastRatio = (foreground: string, background: string): number => {
    const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].sort(
      (a, b) => b - a,
    ) as [number, number];
    return (lighter + 0.05) / (darker + 0.05);
  };

  it('keeps every text token at WCAG AA (4.5:1) on both background and surface', () => {
    const textTokens = [
      colors.textPrimary,
      colors.link,
      colors.textSecondary,
      colors.textMuted,
      colors.textFaint,
      colors.placeholder,
      colors.danger,
      colors.warning,
      colors.success,
    ];

    textTokens.forEach((token) => {
      expect(contrastRatio(token, colors.background)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(token, colors.surface)).toBeGreaterThanOrEqual(4.5);
    });
  });

  it('keeps the CTA gradient perceivable against the page and legible under its white label', () => {
    // WCAG 1.4.11 non-text contrast: the button's edge must be visible
    // against the page (3:1), while its label must clear text AA (4.5:1) at
    // BOTH gradient ends — the pair squeezes the accent from both sides.
    const gradientEnds = [colors.primaryGradientStart, colors.primaryGradientEnd];

    gradientEnds.forEach((end) => {
      expect(contrastRatio(end, colors.background)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(colors.onPrimary, end)).toBeGreaterThanOrEqual(4.5);
    });
    // `primary` is a fill/border only, never text — the 3:1 non-text rule
    // applies. Re-check this assertion if it is ever used as a text color.
    expect(contrastRatio(colors.primary, colors.background)).toBeGreaterThanOrEqual(3);
  });
});
