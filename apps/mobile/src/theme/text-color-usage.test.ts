import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { colors } from './tokens';

// A STRUCTURAL guard, not a value check: it reads the real screen and
// component sources and fails if any of them uses a palette token as a TEXT
// colour that is not legible as text.
//
// Why this exists. `tokens.test.ts` asserts that every *text* token clears
// WCAG AA (4.5:1), and separately that `primary` clears the *non-text* bar
// (3:1) — which is the correct bar, because `primary` is a button fill and a
// border, never words. Those two assertions are individually right and
// together leave a hole: nothing notices when a fill-only colour starts being
// used as text. That is not hypothetical. The black+navy repaint pointed the
// Terms/Privacy links at `colors.primary`, which measures 3.93:1 on black —
// below the text bar — and the whole suite stayed green, because no test
// connected "which tokens are legible as text" to "which tokens screens
// actually put on text".
//
// Checking the source text rather than a rendered tree is deliberate: a
// render test can only cover the states it happens to drive, so a colour on a
// rarely-shown error branch would slip through. Every `color:` in the
// codebase is in scope here regardless of when it renders.

const THEME_DIR = __dirname;
const SRC_DIR = join(THEME_DIR, '..');

// Tokens legible as text anywhere the app puts text: they clear 4.5:1
// against BOTH `background` and `surface` (proven in tokens.test.ts, which
// computes the ratios rather than trusting this list).
const TEXT_SAFE_TOKENS = [
  'textPrimary',
  'textSecondary',
  'textMuted',
  'textFaint',
  'placeholder',
  'link',
  'danger',
  'warning',
  'success',
] as const;

// Tokens that are legible as text ONLY on a specific fill, so the general
// page-background bar does not apply to them. Each needs a stated reason —
// this list is the exception, and it should stay short.
const ON_FILL_ONLY_TOKENS: Readonly<Record<string, string>> = {
  // White, and only ever placed on a `primary`/gradient fill. Its contrast is
  // asserted against BOTH gradient stops in tokens.test.ts.
  onPrimary: 'only ever rendered on a primary or gradient fill',
};

const collectSourceFiles = (relativeDir: string): readonly string[] => {
  const dir = join(SRC_DIR, relativeDir);
  return readdirSync(dir)
    .filter((entry) => /\.tsx?$/.test(entry) && !/\.(test|spec)\.tsx?$/.test(entry))
    .map((entry) => join(relativeDir, entry));
};

interface TextColorUsage {
  readonly file: string;
  readonly token: string;
  readonly line: number;
}

const findTextColorUsages = (): readonly TextColorUsage[] => {
  const files = [...collectSourceFiles('screens'), ...collectSourceFiles('components')];

  return files.flatMap((file) => {
    const lines = readFileSync(join(SRC_DIR, file), 'utf8').split('\n');
    return lines.flatMap((text, index) => {
      // `color:` must OPEN the line, which is what a style property looks
      // like (`    color: colors.textPrimary,`). Two things are excluded on
      // purpose:
      // - `backgroundColor` / `borderColor` / `shadowColor` — non-text uses
      //   this rule does not govern (and the leading-anchor drops them, since
      //   they are not at the start of the line).
      // - Gradient colour stops, written `{ color: colors.x }` inside an
      //   array. Those are paint, not text. A looser pattern flags them and
      //   the guard immediately starts crying wolf — which is worse than no
      //   guard, because the fix becomes "add an exception" every time.
      const match = /^\s*color:\s*colors\.([a-zA-Z]+)/.exec(text);
      return match === undefined || match === null
        ? []
        : [{ file, token: match[1] as string, line: index + 1 }];
    });
  });
};

describe('text colour usage across screens and components', () => {
  it('finds text colours to check at all — a silent zero would make this test vacuous', () => {
    expect(findTextColorUsages().length).toBeGreaterThan(10);
  });

  it('only ever puts text-legible tokens on text', () => {
    const allowed = new Set<string>([...TEXT_SAFE_TOKENS, ...Object.keys(ON_FILL_ONLY_TOKENS)]);

    const violations = findTextColorUsages().filter((usage) => !allowed.has(usage.token));

    // Named rather than counted, so a failure says exactly what to fix.
    expect(
      violations.map((usage) => `${usage.file}:${usage.line} uses colors.${usage.token} as text`),
    ).toEqual([]);
  });

  it('keeps the text-safe list honest — every token on it really exists in the palette', () => {
    // A typo here would silently widen the allowlist instead of narrowing it.
    [...TEXT_SAFE_TOKENS, ...Object.keys(ON_FILL_ONLY_TOKENS)].forEach((token) => {
      expect(colors).toHaveProperty(token);
    });
  });

  it('excludes the fill-and-border accents from the text-safe list', () => {
    // These are the tokens the rule exists to keep OFF text. If a future
    // change makes one of them legible as text, lighten it and add it to
    // TEXT_SAFE_TOKENS deliberately — do not delete this assertion.
    const allowed = new Set<string>([...TEXT_SAFE_TOKENS, ...Object.keys(ON_FILL_ONLY_TOKENS)]);

    [
      'primary',
      'primaryPressed',
      'primaryGradientStart',
      'primaryGradientEnd',
      'primarySubtle',
    ].forEach((token) => {
      expect(allowed.has(token)).toBe(false);
    });
  });
});
