# Navy Theme + Single-Page Welcome Screen — Implementation Plan

**Status:** planned, not implemented. Written 2026-08-03.
**Branch:** `claude/first-screen-navy-theme-rxh1ff`
**Audience:** an engineer (or a fresh Claude session) with **no prior context on this task**. Everything needed is below.

---

## 1. What this task is

The owner supplied five screenshots of a different app ("AdKan") as a **visual reference**: a dark, near-black UI with a large centered illustration, a big bold headline, muted body copy, and a full-width rounded green gradient CTA at the bottom.

The owner wants Lockal Time's **first screen** (Screen 1, the onboarding/welcome screen) to look like that reference, with two deviations:
- **Navy blue instead of green.**
- **Keep Lockal Time's existing logo** (not the reference's brain illustration).

### Decisions the owner already made (do not re-litigate)

| Question | Decision |
|---|---|
| Theme scope | **Whole app to dark navy** — all 17 screens, replacing the light palette outright |
| Screen 1 structure | **Collapse the 3-page carousel to a single welcome page** |
| Navy treatment | **Deep navy background + blue gradient CTA** (gradient, not flat fill) |
| Logo treatment | **Bare ring mark, no backdrop tile** (no teal square behind it) |

### Two consequences the owner was told about and accepted
1. Collapsing to one page **drops two screens' worth of copy** (`howSessionsWork`, `whyPermissionsMatter`) from both locales. "How sessions work" is then not explained anywhere in the onboarding flow.
2. `react-native-safe-area-context` gets its **first real use**; a `SafeAreaProvider` must be mounted in `App.tsx`, which touches the app shell rather than only Screen 1.

---

## 2. Orientation: the codebase

Monorepo at repo root. Only `apps/mobile` is touched by this task.

- `apps/mobile` is **deliberately excluded from npm workspaces** (root `workspaces` is `["apps/server"]`). It has its own `node_modules`. Run `npm install` **inside `apps/mobile`**.
- Relevant paths:
  - `apps/mobile/src/theme/tokens.ts` — the single source of all design tokens
  - `apps/mobile/src/theme/tokens.test.ts` — pins every token value with exact-shape `toEqual`
  - `apps/mobile/src/screens/OnboardingScreen.tsx` + `.spec.tsx` — Screen 1
  - `apps/mobile/src/App.tsx` — app shell + first-launch gates
  - `apps/mobile/src/i18n/locales/{en,he}.ts` — translation bundles
  - `apps/mobile/e2e/flows/*.yaml` — Maestro E2E flows
  - `docs/DESIGN_GUIDELINES.md` — the design system doc

### Project rules that bind this task
From `CLAUDE.md` and `.claude/skills/`:
- **TDD is mandatory.** Write/extend the `.test.ts` / `.spec.tsx` file *first*, agreed as correct, before implementation code.
- **No hardcoded UI strings.** Everything user-visible flows through `t()`. Both `en` and `he` always, from day one.
- **No ad-hoc style values.** Screens style from `theme/tokens.ts` only — never a raw hex or a magic number.
- **RTL-safe.** Use logical properties (`marginStart`/`marginEnd`, not `marginLeft`/`marginRight`). Never branch styling on locale.
- **Documentation-first close-out.** A task isn't done until `backlog.md` is checked off and every `.md` whose claims changed is updated in the same commit.
- Read the relevant `.claude/skills/` (`code-style`, `typescript-strictness`, `i18n`, `testing-standards`) before writing code.

### Baseline (verified 2026-08-03, before any change)
```
apps/mobile: 55 test suites, 667 tests, all passing
npx tsc --noEmit: exit 0
```
Record this. The suite must be green again at the end, with the test count changed only by tests you deliberately added or removed.

---

## 3. Verified findings (evidence gathered, not assumed)

These were each checked against the real codebase. They are why the plan looks the way it does.

### F1 — The whole-app repaint is a one-file change ✅
`grep` for `#RRGGBB` literals across `apps/mobile/src`, excluding `theme/tokens.ts`, returns **0 hits**. Every one of the 17 screens already consumes semantic tokens (`colors.background`, `colors.textPrimary`, …). **No spec asserts a color value.**

**Therefore:** changing the *values* in `tokens.ts` repaints all 17 screens with zero screen-file edits. This is the single most important fact in this plan.

### F2 — No native dependency is needed for the gradient ✅
React Native 0.86 ships built-in CSS gradients via the `experimental_backgroundImage` style prop (typed as `LinearGradientValue` in `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts:520`), and `newArchEnabled=true` is already set in `apps/mobile/android/gradle.properties:47`.

**Verified by writing and running a throwaway spec:** the object form survives `StyleSheet.flatten` intact, coexists with `borderRadius` on the same View, and `npx tsc --noEmit` accepts it inside `StyleSheet.create`. Confirmed working shape:
```ts
experimental_backgroundImage: [
  {
    type: 'linear-gradient',
    direction: 'to right',
    colorStops: [{ color: '#3A5FB5' }, { color: '#4A72CF' }],
  },
],
```
`processBackgroundImage.js`'s direction regex accepts `to top|bottom|left|right` (and corner pairs), plus angle units `deg|grad|rad|turn`. Default direction if omitted is `180deg` (top→bottom).

**Trade-off accepted:** the prop is `experimental_`-prefixed and may be renamed in a future RN upgrade. This was judged better than adding `react-native-linear-gradient` (a native module) for one button — no Podfile change, no Gradle change, no risk to the macOS `ios-build` CI job, no Jest mock.

### F3 — Logo geometry, measured from the real asset ✅
Measured from `apps/mobile/ios/LockalTime/Images.xcassets/AppIcon.appiconset/icon-1024.png` (1024×1024, teal `#0F6B5C` background):
- Outer ring, outer edge: x 180 → 843 ⇒ **Ø 664**
- Ring stroke width: **64**
- Inner filled dot: x 372 → 651 ⇒ **Ø 280**

As ratios of the ring's outer diameter `S`:
- `borderWidth = S × 0.0964` (64/664)
- `innerDotDiameter = S × 0.4217` (280/664)

At `S = 160`: `borderWidth ≈ 15`, `innerDot ≈ 68`.

### F4 — Reference screenshot geometry, measured ✅
Reference image is 1179×2556 px @3x ⇒ **393×852 pt** logical.

| Element | Measured (pt) | Maps to existing token |
|---|---|---|
| Background | `#000000` | — (we use navy instead) |
| Hero art | 213 × 169, centered, top at y≈213 | — |
| Title | ~34 pt bold, white, centered | **new** `typography.displayLarge` |
| Body | 16 pt, line-height ≈22.4, `#8D8D92`, centered | **`typography.body` exactly** (16 × 1.4 = 22.4) ✅ |
| CTA height | 51.7 | **`sizing.buttonHeight` = 52** ✅ |
| CTA corner radius | ≈15.3 | **`radius.lg` = 16** ✅ |
| CTA side margins | 20 | `spacing.md` (16) — closest token; do not invent 20 |
| CTA bottom gap | ≈48 above home indicator | **`spacing['2xl']` = 48** ✅ |
| CTA fill | left→right gradient `#5D974D` → `#8BC474` | navy equivalent below |

Four of the reference's numbers already *are* our tokens. The layout is compatible with the design system.

### F5 — Contrast of the proposed palette was computed, and the first draft failed ✅
The initial palette draft failed WCAG in four places. Values were corrected and re-verified. **Use the final table in §4 — not any earlier draft.** All final values pass:
- text tokens ≥ 4.5:1 on **both** `background` and `surface`
- CTA gradient: **both** ends ≥ 3.0:1 vs background (WCAG 1.4.11, so the button's edge is perceivable) **and** ≥ 4.5:1 against its white label
- semantic colors ≥ 4.5:1 as text

Note the real constraint discovered here: the gradient is squeezed from both sides. Too dark and the button edge vanishes against navy; too light and the white label fails. The workable band is roughly vs-background 3.0–4.13 and white-label 4.57–6.03, which is why the final gradient (`#3A5FB5` → `#4A72CF`) spans a narrower range than the reference's green.

---

## 4. The final palette

Every token keeps its **name and semantic role**; only the value changes. That is what makes F1 work.

### `colors` — replace wholesale in `apps/mobile/src/theme/tokens.ts`

```ts
export const colors = {
  // Surfaces
  background: '#0A1024',
  surface: '#1B2444',
  surfaceActive: '#26325C',
  border: '#232D52',
  borderStrong: '#3B4877',
  black: '#000000',            // UNCHANGED — camera viewfinder letterboxing only

  // Text (strongest to faintest)
  textPrimary: '#FFFFFF',
  textSecondary: '#C3CBDF',
  textMuted: '#A3ACC7',
  textFaint: '#8A93B6',
  placeholder: '#949DBE',

  // Brand accent — navy blue
  primary: '#4269C4',
  primaryPressed: '#2E4E9E',
  primaryGradientStart: '#3A5FB5',   // NEW
  primaryGradientEnd: '#4A72CF',     // NEW
  onPrimary: '#FFFFFF',

  // Semantic — lightened for a dark background; the old dark values
  // (#B00020 etc.) are unreadable on navy.
  danger: '#FF6B7A',
  warning: '#F0A34A',
  success: '#4ADE80',

  // Dialog/overlay scrim — darkened; the old #44444488 barely dims navy.
  overlay: '#01050FCC',
} as const;
```

**Verified contrast ratios** (bg = `#0A1024`, surf = `#1B2444`):

| Token | Value | vs bg | vs surface | White label | Verdict |
|---|---|---|---|---|---|
| `textPrimary` | `#FFFFFF` | 18.88 | 15.19 | — | PASS |
| `textSecondary` | `#C3CBDF` | 11.62 | 9.35 | — | PASS |
| `textMuted` | `#A3ACC7` | 8.34 | 6.72 | — | PASS |
| `textFaint` | `#8A93B6` | 6.23 | 5.01 | — | PASS |
| `placeholder` | `#949DBE` | 7.03 | 5.66 | — | PASS |
| `primary` | `#4269C4` | 3.64 | — | 5.19 | PASS |
| `primaryGradientStart` | `#3A5FB5` | 3.13 | — | 6.03 | PASS |
| `primaryGradientEnd` | `#4A72CF` | 4.13 | — | 4.57 | PASS |
| `danger` | `#FF6B7A` | 6.86 | 5.52 | — | PASS |
| `warning` | `#F0A34A` | 9.03 | 7.26 | — | PASS |
| `success` | `#4ADE80` | 10.83 | 8.72 | — | PASS |

Elevation separation vs background: `surface` 1.24, `border` 1.41, `surfaceActive` 1.52, `borderStrong` 2.14.

`primary` is used **only** as `backgroundColor` and `borderColor` across the codebase — never as a text color — so WCAG's 3:1 non-text threshold applies to it, not 4.5:1. If you ever make it a text color, re-check.

`primaryPressed` currently has **no caller** (it is reserved). Its vs-background ratio is therefore unconstrained.

### `typography` — add one token
```ts
displayLarge: { fontSize: 34, fontWeight: '700', lineHeight: 34 * LINE_HEIGHT_RATIO },  // = 47.6
```
The reference headline measures ~34 pt, genuinely larger than the existing `display` (28). The 1.4× line-height rule has no exceptions.

### `sizing` — add one token
```ts
heroLogo: 160,
```

---

## 5. Edge cases found during the audit — every one of these breaks if ignored

These were found by actually grepping the repo. **This list is the main value of this document.**

### E1 — `App.spec.tsx` presses the skip button that this change deletes 🔴
`apps/mobile/src/App.spec.tsx:355`:
```ts
await fireEvent.press(screen.getByTestId('onboarding-skip'));
```
Inside the test at line 349, `'skipping onboarding on first launch advances to permission priming and persists the flag'`.

**Fix:** the single-page screen has no skip. Repoint this test at the new CTA (`onboarding-primary-cta`) and rename it to reflect that completing — not skipping — is now the only path. Line 339's test (`'renders the onboarding carousel on first launch'`) also needs renaming; it only asserts `onboarding-screen`, so its body still works.

### E2 — Maestro E2E flows silently break 🔴
`apps/mobile/e2e/flows/01-host-request-otp.yaml:12` and `10-solo-request-otp.yaml:8` both do:
```yaml
- tapOn:
    id: 'onboarding-skip'
    optional: true
```
Because it's `optional: true`, the step **won't error** when the ID disappears — it just no-ops. The app then sits on the onboarding screen and the later `- assertVisible: id: 'auth-screen'` fails, with a confusing "auth screen not visible" message that points nowhere near the real cause.

**Fix:** change both to `id: 'onboarding-primary-cta'`. Keep `optional: true`.

(Note: per `CLAUDE.md`, these flows are written but have never actually been run — no emulator/simulator/Maestro CLI is available. Update them anyway; do not attempt to run them.)

### E3 — `AuthScreen`'s dialog disappears against navy 🔴
`apps/mobile/src/screens/AuthScreen.tsx:296-299`:
```ts
dialog: {
  backgroundColor: colors.background,   // <-- white dialog on a white page + scrim
  borderRadius: radius.xl,
  padding: spacing.lg,
},
```
This is the **one genuine inverted assumption** in the codebase. In a light theme a white dialog over a scrim-dimmed white page reads fine. Inverted, it becomes a navy dialog on a navy page behind a dark scrim — it visually merges with the background and the dialog's edges vanish.

**Fix:** `backgroundColor: colors.surface`, and add `borderWidth: 1, borderColor: colors.borderStrong` so the dialog has a defined edge. This is the **only screen file** that needs a change for the repaint.

### E4 — No `StatusBar` exists anywhere 🔴
`grep` for `StatusBar` across `apps/mobile/src` and `android/app/src/main` returns **nothing**. On a dark app the OS draws dark status-bar icons over a dark background — the clock and battery become invisible on Android.

**Fix:** add `<StatusBar barStyle="light-content" backgroundColor={colors.background} />` in `App.tsx`. Note `backgroundColor` is Android-only; `barStyle` covers both platforms.

### E5 — iOS launch screen is white ⚠️
`apps/mobile/ios/LockalTime/LaunchScreen.storyboard:30`:
```xml
<color key="backgroundColor" systemColor="systemBackgroundColor" cocoaTouchSystemColor="whiteColor"/>
```
Cold start flashes white before React Native mounts the navy UI.

**Fix:** set the storyboard background to the navy `#0A1024` (RGB 10/16/36 ⇒ `red="0.039" green="0.063" blue="0.141" alpha="1"`, colorSpace `custom`/`sRGB`). Cannot be verified without a Mac — mark it a manual-QA item in `docs/MANUAL_QA.md`.

### E6 — Android window background is white ⚠️
`apps/mobile/android/app/src/main/res/values/styles.xml` — `AppTheme` extends `Theme.AppCompat.DayNight.NoActionBar` and sets no `android:windowBackground`, so it inherits white in light mode. Same cold-start flash. `values/colors.xml` is empty.

**Fix:** add a `navy_background` color to `colors.xml` and set `<item name="android:windowBackground">@color/navy_background</item>` plus `<item name="android:windowLightStatusBar">false</item>` on `AppTheme`. Verify with a real Gradle build; a physical device is not available, so on-device confirmation is a manual-QA item.

### E7 — `useSafeAreaInsets` throws without a provider, and the shipped Jest mock needs `.default` 🔴
`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx:147-160` throws:
> `No safe area value available. Make sure you are rendering <SafeAreaProvider> at the top of your app.`

Every screen spec renders its screen **directly**, with no provider. So the moment `OnboardingScreen` uses `SafeAreaView`/`useSafeAreaInsets`, its spec must mock the module.

The library ships a mock at `react-native-safe-area-context/jest/mock`, but **it uses a `default` export**. The idiomatic one-liner fails with `TypeError: (0, _reactNativeSafeAreaContext.useSafeAreaInsets) is not a function`. **This was hit and fixed during the audit.** The working form:
```ts
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
```
The mock reports **all insets as 0** and a 320×640 frame — so a test asserting the CTA's bottom gap sees only the token padding, not a simulated home indicator.

`jest.config.js`'s `transformIgnorePatterns` **already includes** `react-native-safe-area-context`, so no config change is needed.

### E8 — `tokens.test.ts` has three exact-shape assertions that will fail 🔴
`apps/mobile/src/theme/tokens.test.ts` uses whole-object `toEqual` as a completeness check — deliberately, so a silently added/removed token fails. Adding `primaryGradientStart`/`End`, `displayLarge`, and `heroLogo` breaks all three:
- the `colors` block (every value changes too)
- the `typography` ramp shape assertion
- the `sizing` table assertion

There is also a `'uses a 1.4x line height on every token, no exceptions'` test that lists ramp tokens by **explicit property access** (not `Object.entries`) — `typography.displayLarge` must be added to that array by hand, or the new token escapes the line-height rule.

### E9 — i18n key surgery 🔴
Remove `onboarding.pages.{valueProposition,howSessionsWork,whyPermissionsMatter}`, `onboarding.skip`, `onboarding.next`. Add `onboarding.title`, `onboarding.body`. Keep `onboarding.getStarted`.

Carry the **`valueProposition` copy** across as the new welcome title/body — it is the value-proposition message and the right one to keep:
- en title: `'Time together, undistracted'`
- en body: `'Lockal Time blocks distracting apps while you and your friends are actually together — so being present is the easy choice.'`
- he title: `'זמן ביחד, בלי הסחות דעת'`
- he body: `'לוקאל טיים חוסמת אפליקציות מסיחות דעת בזמן שאתם באמת ביחד — כך שלהיות נוכחים הופך לבחירה הקלה.'`

Both bundles must change together: `he` is typed as `TranslationSchema = typeof en`, so drift is a **compile error**, and `src/i18n/locales/locale-parity.test.ts` walks both trees at runtime as a second guard (it also fails on blank values).

### E10 — Gradient direction does not auto-mirror under RTL ⚠️
RN mirrors layout under RTL, but `experimental_backgroundImage`'s `direction: 'to right'` is a paint instruction, not a layout property — it will **not** flip for Hebrew. The visual effect is subtle (a light-to-dark sweep pointing the "wrong" way), and the `.claude/skills/i18n` rule forbids branching styles on locale. **Recommendation:** use `to right` unconditionally and accept it; note it in `docs/MANUAL_QA.md` for a human to judge on-device. Do not add a locale branch.

### E11 — Small-screen / large-font overflow ⚠️
The reference is a 393×852 pt device. Rough stack on a 320×568 pt phone (iPhone SE): hero 160 + gap 48 + title ~48 + gap 16 + body ~67 + CTA 52 + bottom 48 ≈ 439 pt, plus top padding. It fits, but not with much room, and OS-level large accessibility font sizes will push it over.

**Recommendation:** let the hero shrink (`flexShrink: 1`) or cap it via `Math.min`, rather than assuming 160 always fits. Do not wrap the whole thing in a `ScrollView` — that fights the "CTA pinned to the bottom" layout.

### E12 — `docs/MANUAL_QA.md` has an obsolete carousel section ⚠️
`docs/MANUAL_QA.md:22-24`, "Phase 1 — Onboarding carousel (Screen 1)", contains an RTL QA item describing swiping through three pages and mirrored pagination dots. That behavior ceases to exist.

**Fix:** replace with a single-page RTL check, and add the new manual-QA items from E5, E6, E10.

### E13 — The app icon stays teal ℹ️
The launcher icon (`ic_launcher*`, `icon-1024.png`) is a white ring on teal `#0F6B5C`. After this change the app is navy but its home-screen icon is still teal. The owner said "keep the logo as it is", so this is **in scope as-is** — but flag it to them as a follow-up, since the icon background no longer matches the brand accent.

---

## 6. Implementation steps, in order

Follow TDD: the test file changes land and are reviewed *before* the implementation in each step.

### Step 0 — Setup
```bash
cd apps/mobile
npm install                 # apps/mobile is NOT in npm workspaces
npx jest --silent           # confirm baseline: 55 suites, 667 tests green
```
> `npm install` may leave a one-line `package-lock.json` diff marking the macOS-only `fsevents` as `"dev": true`. That is Linux-vs-macOS churn, unrelated to this task — `git checkout -- package-lock.json` it rather than committing it.

### Step 1 — Tokens (test first)
1. Update `src/theme/tokens.test.ts`: new `colors` values + 2 new keys; `displayLarge` in the ramp shape **and** in the line-height array; `heroLogo` in the sizing table. (E8)
2. Update `src/theme/tokens.ts` to match §4.
3. `npx jest src/theme` → green.
4. `npx jest` → **expect failures only where a screen legitimately reads differently**; there should be none, per F1. If a screen spec fails here, you've found an inverted assumption the audit missed — investigate, don't paper over it.

### Step 2 — `AuthScreen` dialog fix (E3)
`dialog` → `colors.surface` + `borderWidth: 1` + `borderColor: colors.borderStrong`.

### Step 3 — `LogoMark` component (test first)
New `src/components/LogoMark.tsx` + `LogoMark.test.tsx`. Props: `size` (default `sizing.heroLogo`), optional `color` (default `colors.textPrimary`).
Ring = a `View` with `borderRadius: radius.full`, `borderWidth = round(size × 0.0964)`; inner dot = a centered `View`, `size × 0.4217`, `borderRadius: radius.full`. (F3)
Give it a `testID` so the screen spec can assert it renders.

### Step 4 — i18n (E9)
Edit `en.ts` first (it defines the schema), then `he.ts`. Run `npx jest src/i18n` and `npx tsc --noEmit`.

### Step 5 — `OnboardingScreen` rewrite (test first)
Rewrite `OnboardingScreen.spec.tsx`: delete the carousel/dots/skip/next tests; keep and adapt the en-copy, he-copy, `onboarding-screen` testID, `onComplete`-fires, and CTA-height-token tests. Add: logo mark renders; container background is `colors.background`; CTA declares the gradient. Add the safe-area mock from E7.

Then rewrite `OnboardingScreen.tsx`:
```
SafeAreaView            flex:1, backgroundColor: colors.background
  View (content)        flex:1, centered, paddingHorizontal: spacing.xl
    LogoMark            sizing.heroLogo, flexShrink per E11
    Text (title)        typography.displayLarge, colors.textPrimary, centered,
                        marginTop: spacing['2xl']
    Text (body)         typography.body, colors.textMuted, centered,
                        marginTop: spacing.md
  TouchableOpacity      testID 'onboarding-primary-cta'
                        height: sizing.buttonHeight, borderRadius: radius.lg,
                        marginHorizontal: spacing.md, marginBottom: spacing['2xl'],
                        experimental_backgroundImage: linear-gradient
                          'to right', primaryGradientStart → primaryGradientEnd
    Text (label)        typography.bodyStrong, colors.onPrimary — t('onboarding.getStarted')
```
Body uses `textMuted` (not `textSecondary`) to match the reference's muted subtitle.
Use `marginStart`/`marginEnd` or `paddingHorizontal`, never `Left`/`Right`.

### Step 6 — App shell
`App.tsx`: wrap the returned tree in `<SafeAreaProvider>`, add `<StatusBar barStyle="light-content" backgroundColor={colors.background} />` (E4). Both `App.spec.tsx` and `App.auth-gate.spec.tsx` will now render a provider — add the E7 mock to both if they fail.

### Step 7 — `App.spec.tsx` (E1)
Repoint the skip test at `onboarding-primary-cta`; rename both affected tests.

### Step 8 — Native launch backgrounds (E5, E6)
iOS storyboard + Android `styles.xml`/`colors.xml`. Neither is verifiable here — mark both manual-QA.

### Step 9 — Maestro flows (E2)
`onboarding-skip` → `onboarding-primary-cta` in flows `01` and `10`.

### Step 10 — Docs
- `docs/DESIGN_GUIDELINES.md`: **§5** (add `displayLarge`), **§6** (add `heroLogo`), **§9** (onboarding is now one welcome page — note the flow is still Onboarding → Permission → Auth, which still satisfies §9's "max 3–5 screens"), **§11** (dark mode is no longer deferred — the app *is* dark; there is still no light variant and no theme switching), **§12** (rewrite the whole palette table, and record that it is a dark navy palette with the contrast ratios from §4).
- `docs/MANUAL_QA.md`: E12, plus new items from E5, E6, E10, E11.
- `CLAUDE.md`: update the status paragraph (the "real color palette swept across all 17 screens" claim now describes a navy dark palette, and Screen 1 is a single welcome page).
- `backlog.md`: add the task, checked off.

### Step 11 — Verify and commit
```bash
cd apps/mobile
npx jest              # all green
npm run lint          # clean
npm run typecheck     # clean
```
`supabase test db` is **not** needed — nothing in this task touches the database.

Commit to `claude/first-screen-navy-theme-rxh1ff`, then `git push -u origin claude/first-screen-navy-theme-rxh1ff`.

---

## 7. Definition of done

- [ ] `apps/mobile` test suite green; count differs from 667 only by deliberately added/removed tests
- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] All 17 screens render navy (no screen still reads a light value) — guaranteed by F1 + the E3 fix
- [ ] Screen 1 is a single welcome page: logo, title, body, gradient CTA
- [ ] No carousel, dots, skip, or `next` copy remain anywhere, **including `App.spec.tsx` and the Maestro flows**
- [ ] `en` and `he` bundles are in parity; no hardcoded strings
- [ ] Docs in Step 10 all updated in the same commit
- [ ] Pushed to `claude/first-screen-navy-theme-rxh1ff`

## 8. Explicitly out of scope

- Running the app or the Maestro flows (no emulator/simulator/Maestro CLI, no physical device, no Mac)
- Redesigning the app icon (E13) — raise with the owner instead
- A light-mode variant or theme switching
- New onboarding copy (the dropped `howSessionsWork` / `whyPermissionsMatter` messaging is a product/copy decision for the owner, not an engineering one)
