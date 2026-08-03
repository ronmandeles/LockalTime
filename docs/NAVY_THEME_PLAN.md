# Black + Navy Theme — Onboarding Flow Restyle (Screens 1–3)

**Status:** planned, not implemented. Written 2026-08-03, revised after owner clarification.
**Branch:** `claude/first-screen-navy-theme-rxh1ff`
**Audience:** an engineer (or a fresh Claude session) with **no prior context on this task**. Everything needed is below.

---

## 1. What this task is

The owner supplied five screenshots of a different app ("AdKan") as a **visual reference**: a pure-black UI with a large centered hero, a big bold headline, muted body copy, and a full-width rounded **green gradient** CTA at the bottom.

The owner wants Lockal Time's **onboarding flow** to look like that reference, with one deliberate difference: **navy blue replaces the green.** Their words: *"the overall UI should look almost the same."*

### Owner decisions (do not re-litigate)

| Question | Decision |
|---|---|
| New-user flow | **Welcome → Permission → Login → Home.** Exactly the three screens that exist today — nothing added, nothing removed |
| Which screens | **Restyle Screens 1, 2 and 3** (Welcome, Permission, Auth) to the reference's visual language |
| New screens | **No.** Do not build the reference's pronoun screen or profile/avatar screen |
| Database changes | **None.** This task is styling, plus one screen's structure and one screen's flow |
| Theme scope | **Whole app goes dark**, so no screen clashes with the restyled flow |
| Background | **Pure black `#000000`**, exactly like the reference. Navy is the *accent* only |
| Screen 1 structure | **Collapse the 3-page carousel to a single welcome page** |
| CTA | **Gradient**, not a flat fill |
| Logo | **Bare ring mark**, no teal backdrop tile |
| Screen 2 badge glyph | **Reuse the Lockal Time ring mark** inside the tinted circle — no icon library, no new dependency |
| Screen 2 "maybe later" | **Match the reference** — show the skip link during priming, not only after a denial |

### Owner was told and accepted
1. Collapsing Screen 1 to one page **drops two screens' worth of copy** (`howSessionsWork`, `whyPermissionsMatter`) from both locales. "How sessions work" is then explained nowhere in onboarding.
2. A *true* navy on black is too low-contrast to be usable, so the accent is a **brighter navy-blue** (`#3563D8` family) rather than a deep `#1B2A6B`.
3. `react-native-safe-area-context` gets its **first real use**; a `SafeAreaProvider` must be mounted in `App.tsx`, touching the app shell.

### ⚠️ The one deliberate behaviour change — "maybe later" during priming

Everything else in this task is styling. **This is not**, and it was decided by the owner with the trade-off stated explicitly.

Today `PermissionPrimingScreen` shows only "Allow" in its `priming` state; the escape hatch (`permission-proceed-anyway`) appears **only after the user has actually declined** the OS permission. The reference shows a "maybe later" link under the CTA immediately, and the owner chose to match it.

**Consequence to expect:** more users will reach Home without ever attempting the screen-time permission — and blocking does not function without it. Those users land in a working app whose core feature silently does nothing. The recovery path already exists (the permission is re-requestable later), but the grant rate will drop. This was accepted knowingly; do not silently re-litigate it, and do not quietly implement the old behaviour instead.

Implementation notes:
- Add the link to the **priming** state, firing the existing `onHandled` callback — the same contract the denied state's proceed-anyway already uses. The screen stays storage-agnostic; the `App` gate still owns what "handled" means.
- Give it its **own** `testID` (`permission-maybe-later`) and its **own** i18n key (`permissionPriming.maybeLater`). Do not reuse `permissionPriming.denied.proceedAnyway` — the two links appear in different states and their copy should be free to diverge.
- The denied state keeps its own proceed-anyway exactly as-is.

---

## 2. Orientation: the codebase

Monorepo at repo root. Only `apps/mobile` is touched.

- `apps/mobile` is **deliberately excluded from npm workspaces** (root `workspaces` is `["apps/server"]`). It has its own `node_modules`. Run `npm install` **inside `apps/mobile`**.
- Paths that matter:
  - `apps/mobile/src/theme/tokens.ts` — single source of all design tokens
  - `apps/mobile/src/theme/tokens.test.ts` — pins every token with exact-shape `toEqual`
  - `apps/mobile/src/screens/OnboardingScreen.tsx` (Screen 1)
  - `apps/mobile/src/screens/PermissionPrimingScreen.tsx` (Screen 2)
  - `apps/mobile/src/screens/AuthScreen.tsx` (Screen 3)
  - each with a sibling `.spec.tsx`
  - `apps/mobile/src/App.tsx` — app shell + first-launch gates
  - `apps/mobile/src/i18n/locales/{en,he}.ts` — translation bundles
  - `apps/mobile/e2e/flows/*.yaml` — Maestro E2E flows
  - `docs/DESIGN_GUIDELINES.md` — the design system doc

### Project rules that bind this task
From `CLAUDE.md` and `.claude/skills/`:
- **TDD is mandatory.** The `.test.ts` / `.spec.tsx` changes land and are agreed correct *before* implementation.
- **No hardcoded UI strings.** Everything user-visible goes through `t()`, in both `en` and `he`.
- **No ad-hoc style values.** Screens style from `theme/tokens.ts` only — never a raw hex or magic number.
- **RTL-safe.** Logical properties (`marginStart`/`marginEnd`), never `Left`/`Right`. Never branch styling on locale.
- **Documentation-first close-out.** Not done until `backlog.md` is ticked and every `.md` whose claims changed is updated in the same commit.
- Read `.claude/skills/` (`code-style`, `typescript-strictness`, `i18n`, `testing-standards`) before writing code.

### Baseline (verified 2026-08-03, before any change)
```
apps/mobile: 55 test suites, 667 tests, all passing
npx tsc --noEmit: exit 0
```
The suite must be green again at the end, differing from 667 only by tests deliberately added or removed.

---

## 3. Verified findings (evidence gathered, not assumed)

### F1 — The whole-app repaint is a one-file change ✅
`grep` for `#RRGGBB` across `apps/mobile/src`, excluding `theme/tokens.ts`, returns **0 hits**. All 17 screens consume semantic tokens. **No spec asserts a color.**

**Therefore:** changing the *values* in `tokens.ts` repaints every screen with zero screen-file edits. The three onboarding screens then get *layout* work on top. This is the most important fact in this plan.

### F2 — No native dependency is needed for the gradient ✅
RN 0.86 ships built-in CSS gradients via `experimental_backgroundImage` (typed `LinearGradientValue`, `node_modules/react-native/Libraries/StyleSheet/StyleSheetTypes.d.ts:520`), and `newArchEnabled=true` is already set (`android/gradle.properties:47`).

**Verified by writing and running a throwaway spec:** the object form survives `StyleSheet.flatten` intact, coexists with `borderRadius` on one View, and `npx tsc --noEmit` accepts it inside `StyleSheet.create`. Working shape:
```ts
experimental_backgroundImage: [
  {
    type: 'linear-gradient',
    direction: 'to right',
    colorStops: [{ color: colors.primaryGradientStart }, { color: colors.primaryGradientEnd }],
  },
],
```
`processBackgroundImage.js`'s regex accepts `to top|bottom|left|right` (+ corner pairs) and `deg|grad|rad|turn`. Omitted direction defaults to `180deg`.

**Trade-off accepted:** `experimental_`-prefixed, so it may be renamed in a future RN upgrade — judged better than a native module for one button (no Podfile/Gradle change, no macOS CI risk, no Jest mock).

### F3 — Logo geometry, measured from the real asset ✅
From `apps/mobile/ios/LockalTime/Images.xcassets/AppIcon.appiconset/icon-1024.png` (1024², teal `#0F6B5C`):
- Outer ring outer edge: x 180 → 843 ⇒ **Ø 664**; stroke **64**; inner dot **Ø 280**

As ratios of ring outer diameter `S`: `borderWidth = S × 0.0964`, `innerDot = S × 0.4217`.
At `S = 160`: borderWidth ≈ **15**, inner dot ≈ **68**.

### F4 — Reference geometry, measured ✅
Both reference screens are 1179×2556 px @3x ⇒ **393×852 pt** logical.

**Screen 1 — Welcome (IMG_3886)**
| Element | Measured (pt) | Token |
|---|---|---|
| Background | `#000000` | `background` |
| Hero art | 213 × 169, centered, top y≈213 | `sizing.heroLogo` (160) |
| Title | ~34 bold, white, centered | **new** `typography.displayLarge` |
| Body | 16 / line-height 22.4, `#8D8D92`, centered | **`typography.body` exactly** ✅ + `textMuted` |
| CTA height | 51.7 | **`sizing.buttonHeight` = 52** ✅ |
| CTA radius | ≈15.3 | **`radius.lg` = 16** ✅ |
| CTA side margins | 20 | `spacing.md` (16) — closest; do not invent 20 |
| CTA bottom gap | ≈48 above home indicator | **`spacing['2xl']` = 48** ✅ |
| CTA fill | left→right gradient | navy gradient |

**Screen 2 — Permission (IMG_3888)**
| Element | Measured (pt) | Token |
|---|---|---|
| Icon badge circle | **Ø 99.7**, fill `#0D1D12` (accent ≈12% over black), glyph `#64C47A` | **new** `sizing.iconBadge` (100) + **new** `colors.primarySubtle` |
| Title | ink 21.3 ⇒ ~22 bold, centered | `typography.display` (28) — see note |
| Body | 3 lines, pitch 22, muted, centered | `typography.body` + `textMuted` ✅ |
| CTA | **52.3** tall | `sizing.buttonHeight` ✅ |
| "Maybe later" link | ink 13, colour `#45643C` | see OD2; **do not copy the colour** — it measures **3.14:1 on black and fails WCAG AA** |

> **Title-size note:** the reference uses ~34 pt on the welcome screen and ~22 pt on the permission screen — a deliberate hierarchy. Mapping those to the new `displayLarge` (34) and the existing `display` (28) preserves the hierarchy using tokens we already have. The permission title lands 6 pt larger than the reference; that is an accepted, documented deviation rather than a fourth display size.

### F5 — Contrast was computed; the first two drafts failed ✅
A navy-background draft and then a black-background draft each failed WCAG in several places before correction. **Use the table in §4 — no earlier draft.** All final values pass:
- text tokens ≥ 4.5:1 on **both** `background` and `surface`
- both gradient ends ≥ 3.0:1 vs background (WCAG 1.4.11 — the button's edge must be perceivable) **and** ≥ 4.5:1 against their white label
- semantic colours ≥ 4.5:1 as text

Black gives more headroom than navy did, but the gradient is still squeezed from both sides: too dark and the button edge vanishes; too light and the white label fails.

### F6 — Reference surface colours, sampled ✅
Sampled from IMG_3890 / IMG_3891: option buttons and text inputs are `#1C1C1D`; emoji tiles are `#2C2C2D`. These are the iOS system dark greys. The reference keeps surfaces **neutral** and lets the accent carry all the colour — this plan does the same.

### F7 — There is no icon library ✅
No `react-native-svg`, no vector-icons, no icon package in `apps/mobile/package.json`, and no screen uses `Image`. The reference's shield-and-lock glyph therefore cannot be drawn as-is.

**Resolved:** reuse the Lockal Time **ring mark** (`LogoMark`, F3) inside the tinted badge circle. Zero new dependencies, fully under our control at any size, and it keeps the macOS `ios-build` CI job untouched — adding `react-native-svg` would have been the only native-linking risk in this whole task.

---

## 4. The final palette — pure black, navy accent

Every token keeps its **name and semantic role**; only values change. That is what makes F1 work.

```ts
export const colors = {
  // Surfaces — neutral greys on true black (F6)
  background: '#000000',
  surface: '#1C1C1E',
  surfaceActive: '#2C2C2E',
  border: '#2C2C2E',
  borderStrong: '#3A3A3C',
  black: '#000000',            // camera viewfinder letterboxing; now equals background

  // Text
  textPrimary: '#FFFFFF',
  textSecondary: '#C7C7CC',
  textMuted: '#8D8D92',        // exactly the reference's body colour
  textFaint: '#86868C',
  placeholder: '#8A8A8F',

  // Brand accent — navy blue, brightened so it survives on black
  primary: '#3563D8',
  primaryPressed: '#2A50BC',
  primaryGradientStart: '#2F5BD0',   // NEW
  primaryGradientEnd: '#3B6FE0',     // NEW
  primarySubtle: '#0C1428',          // NEW — icon-badge fill (accent ≈12% over black)
  onPrimary: '#FFFFFF',

  // Semantic — lightened; the old dark values (#B00020 etc.) are unreadable on black
  danger: '#FF6B7A',
  warning: '#F0A34A',
  success: '#4ADE80',

  overlay: '#000000CC',
} as const;
```

**Verified contrast** (bg `#000000`, surf `#1C1C1E`):

| Token | Value | vs bg | vs surface | White label | Verdict |
|---|---|---|---|---|---|
| `textPrimary` | `#FFFFFF` | 21.00 | 17.01 | — | PASS |
| `textSecondary` | `#C7C7CC` | 12.47 | 10.10 | — | PASS |
| `textMuted` | `#8D8D92` | 6.36 | 5.15 | — | PASS |
| `placeholder` | `#8A8A8F` | 6.11 | 4.95 | — | PASS |
| `textFaint` | `#86868C` | 5.80 | 4.70 | — | PASS |
| `primary` | `#3563D8` | 3.93 | — | 5.35 | PASS |
| `primaryGradientStart` | `#2F5BD0` | 3.53 | — | 5.95 | PASS |
| `primaryGradientEnd` | `#3B6FE0` | 4.54 | — | 4.63 | PASS |
| `danger` | `#FF6B7A` | 7.64 | 6.19 | — | PASS |
| `warning` | `#F0A34A` | 10.04 | 8.14 | — | PASS |
| `success` | `#4ADE80` | 12.05 | 9.76 | — | PASS |

Surface separation vs black: `surface` 1.23, `surfaceActive`/`border` 1.51, `borderStrong` 1.85, `primarySubtle` 1.15.

- `primary` is used **only** as `backgroundColor`/`borderColor` — never as text — so WCAG's 3:1 non-text rule applies, not 4.5:1. Re-check if that ever changes.
- `primaryPressed` measures 2.97 vs black but has **no caller** (reserved token), and a pressed state is only visible while a finger covers the control. Unconstrained by design.

### `typography` — add one token
```ts
displayLarge: { fontSize: 34, fontWeight: '700', lineHeight: 34 * LINE_HEIGHT_RATIO },  // 47.6
```
The 1.4× line-height rule has no exceptions.

### `sizing` — add two tokens
```ts
heroLogo: 160,
iconBadge: 100,
```

---

## 5. Edge cases found by auditing the repo — each of these breaks if ignored

### E1 — `App.spec.tsx` presses the skip button this change deletes 🔴
`apps/mobile/src/App.spec.tsx:355`: `await fireEvent.press(screen.getByTestId('onboarding-skip'));`, inside the test at line 349 (`'skipping onboarding on first launch advances to permission priming and persists the flag'`).
**Fix:** repoint at `onboarding-primary-cta` and rename the test — completing, not skipping, is now the only path. Line 339's test name (`'renders the onboarding carousel…'`) also needs renaming; its body only asserts `onboarding-screen`, so it still works.

### E2 — Maestro flows break silently 🔴
`apps/mobile/e2e/flows/01-host-request-otp.yaml:12` and `10-solo-request-otp.yaml:8`:
```yaml
- tapOn:
    id: 'onboarding-skip'
    optional: true
```
`optional: true` means the step **won't error** when the ID vanishes — it no-ops. The app then sits on onboarding and the later `assertVisible: id: 'auth-screen'` fails with a message pointing nowhere near the real cause.
**Fix:** change both to `onboarding-primary-cta`, keep `optional: true`. (Per `CLAUDE.md` these flows have never been run — no emulator/simulator/Maestro CLI. Update them; do not try to run them.)

### E3 — `AuthScreen`'s dialog disappears 🔴
`apps/mobile/src/screens/AuthScreen.tsx:296-299` sets `dialog: { backgroundColor: colors.background, … }`. The **one genuine inverted assumption** in the codebase: a white dialog over a scrim-dimmed white page reads fine; a black dialog over a scrim-dimmed black page has no visible edge at all.
**Fix:** `backgroundColor: colors.surface` + `borderWidth: 1` + `borderColor: colors.borderStrong`.

### E4 — No `StatusBar` exists anywhere 🔴
`grep` for `StatusBar` across `apps/mobile/src` and `android/app/src/main` returns nothing. On a dark app the OS draws dark status-bar icons on a dark background — clock and battery become invisible on Android.
**Fix:** `<StatusBar barStyle="light-content" backgroundColor={colors.background} />` in `App.tsx` (`backgroundColor` is Android-only; `barStyle` covers both).

### E5 — iOS launch screen is white ⚠️
`apps/mobile/ios/LockalTime/LaunchScreen.storyboard:30` uses `cocoaTouchSystemColor="whiteColor"`. Cold start flashes white before RN mounts.
**Fix:** set it to black. Unverifiable without a Mac — add to `docs/MANUAL_QA.md`.

### E6 — Android window background is white ⚠️
`android/app/src/main/res/values/styles.xml`: `AppTheme` extends `Theme.AppCompat.DayNight.NoActionBar` and sets no `android:windowBackground`, inheriting white in light mode. `values/colors.xml` is empty.
**Fix:** add a black colour to `colors.xml`, set `android:windowBackground` and `android:windowLightStatusBar=false` on `AppTheme`. Verify with a Gradle build; on-device confirmation is manual QA (no physical device).

### E7 — `useSafeAreaInsets` throws without a provider, and the shipped Jest mock needs `.default` 🔴
`node_modules/react-native-safe-area-context/src/SafeAreaContext.tsx:147-160` throws *"No safe area value available…"*. Every screen spec renders its screen **directly**, with no provider.
The library ships `react-native-safe-area-context/jest/mock`, but it uses a **`default` export** — the idiomatic one-liner fails with `TypeError: (0, _reactNativeSafeAreaContext.useSafeAreaInsets) is not a function`. **Hit and fixed during the audit.** Working form:
```ts
jest.mock('react-native-safe-area-context', () =>
  require('react-native-safe-area-context/jest/mock').default,
);
```
The mock reports **all insets 0** and a 320×640 frame, so a test asserting the CTA's bottom gap sees only token padding. `jest.config.js`'s `transformIgnorePatterns` **already includes** the package — no config change needed.

### E8 — `tokens.test.ts` has three exact-shape assertions that will fail 🔴
It uses whole-object `toEqual` as a deliberate completeness check. Adding `primaryGradientStart`/`End`/`primarySubtle`, `displayLarge`, `heroLogo` and `iconBadge` breaks the `colors`, `typography` and `sizing` blocks (and every colour value changes).
There is also a `'uses a 1.4x line height on every token, no exceptions'` test listing ramp tokens by **explicit property access** — `typography.displayLarge` must be added there by hand or it escapes the rule.

### E9 — i18n key surgery 🔴
Remove `onboarding.pages.{valueProposition,howSessionsWork,whyPermissionsMatter}`, `onboarding.skip`, `onboarding.next`. Add `onboarding.title`, `onboarding.body`. Keep `onboarding.getStarted`.
Carry the **`valueProposition`** copy across as the welcome title/body:
- en title: `'Time together, undistracted'`
- en body: `'Lockal Time blocks distracting apps while you and your friends are actually together — so being present is the easy choice.'`
- he title: `'זמן ביחד, בלי הסחות דעת'`
- he body: `'לוקאל טיים חוסמת אפליקציות מסיחות דעת בזמן שאתם באמת ביחד — כך שלהיות נוכחים הופך לבחירה הקלה.'`

Both bundles change together: `he` is typed `TranslationSchema = typeof en`, so drift is a **compile error**, and `src/i18n/locales/locale-parity.test.ts` walks both trees at runtime (it also fails on blank values).

### E10 — Gradient direction does not auto-mirror under RTL ⚠️
RN mirrors layout under RTL, but `experimental_backgroundImage` is a paint instruction, not layout — `to right` will **not** flip for Hebrew. The effect is subtle and the i18n skill forbids locale-branched styles. **Use `to right` unconditionally**; note it in `docs/MANUAL_QA.md` for a human to judge on-device.

### E11 — Small-screen / large-font overflow ⚠️
The reference is 393×852 pt. On a 320×568 pt phone the Screen 1 stack (hero 160 + 48 + title ~48 + 16 + body ~67 + CTA 52 + 48 ≈ 439 pt) fits, but not with much room, and OS large-font settings will push it over.
**Recommendation:** let the hero shrink (`flexShrink: 1`) or cap it with `Math.min`. Do **not** wrap in a `ScrollView` — that fights the pinned-bottom CTA.

### E12 — `docs/MANUAL_QA.md` has an obsolete carousel section ⚠️
`docs/MANUAL_QA.md:22-24` ("Phase 1 — Onboarding carousel (Screen 1)") describes swiping three pages with mirrored dots. That behaviour ceases to exist.
**Fix:** replace with a single-page RTL check; add new items from E5, E6, E10, E11.

### E13 — Screen 2 and 3 specs will need updating 🔴
`PermissionPrimingScreen.spec.tsx` and `AuthScreen.spec.tsx` pin structure and behaviour. Adding the icon badge, centring text and swapping the CTA fill will touch them (and they need the E7 mock if the screens adopt `SafeAreaView`).

**Exactly one behavioural assertion is allowed to change:** the new priming-state "maybe later" link (§1). Add tests for it — that it renders in the priming state, fires `onHandled` once, and that the denied state still has its own separate proceed-anyway.

**Everything else must keep passing unmodified** — the priming/denied state machine, the `AppState` re-check on return from Settings, the battery-optimization fire-and-forget, and every OTP step on Screen 3. If one of those fails, you changed something you shouldn't have; fix the code, not the test.

### E14 — The app icon stays teal ℹ️
The launcher icon is a white ring on teal `#0F6B5C`. After this change the app is black-and-navy but its home-screen icon is still teal. The owner said keep the logo as-is, so this is in scope as-is — flag it as a follow-up.

---

## 6. Implementation steps, in order

TDD: test changes land and are reviewed *before* implementation in each step.

### Step 0 — Setup
```bash
cd apps/mobile
npm install                 # apps/mobile is NOT in npm workspaces
npx jest --silent           # confirm baseline: 55 suites, 667 tests green
```
> `npm install` may leave a one-line `package-lock.json` diff marking macOS-only `fsevents` as `"dev": true`. That is Linux-vs-macOS churn — `git checkout -- package-lock.json`, don't commit it.

### Step 1 — Tokens (test first)
Update `src/theme/tokens.test.ts` (all colour values + 3 new colour keys; `displayLarge` in the ramp shape **and** the line-height array; `heroLogo` + `iconBadge` in sizing), then `src/theme/tokens.ts` per §4.
`npx jest src/theme` → green. Then `npx jest` → per F1 there should be **no** other failures. If a screen spec fails here you've found an inverted assumption the audit missed — investigate, don't paper over it.

### Step 2 — `AuthScreen` dialog fix (E3)
`dialog` → `colors.surface` + `borderWidth: 1` + `borderColor: colors.borderStrong`.

### Step 3 — Shared pieces (test first)
- `src/components/LogoMark.tsx` — ring + inner dot at F3's ratios. Props: `size` (default `sizing.heroLogo`), `color` (default `colors.textPrimary`). Ring = `View` with `borderRadius: radius.full` and `borderWidth = round(size × 0.0964)`; dot = centred `View` at `size × 0.4217`. Give it a `testID`. Used at two sizes: the Screen 1 hero (`sizing.heroLogo`) and inside the Screen 2 badge.
- `src/components/IconBadge.tsx` — Ø`sizing.iconBadge` circle, `backgroundColor: colors.primarySubtle`, `borderRadius: radius.full`, centring its child. On Screen 2 that child is a `LogoMark` tinted `colors.primary`, sized to roughly half the badge (≈48) so it sits inside the circle the way the reference's glyph does.
- `src/components/GradientButton.tsx` — the CTA shared by all three screens: `height: sizing.buttonHeight`, `borderRadius: radius.lg`, the F2 gradient, label `typography.bodyStrong` / `colors.onPrimary`. Extracting this once avoids repeating the gradient literal in three files and keeps the "no ad-hoc values" rule honest. Accepts a `testID` so each screen keeps its own.

### Step 4 — i18n (E9)
Edit `en.ts` first (it defines the schema), then `he.ts`. Two changes:
1. The onboarding key surgery in E9.
2. **Add `permissionPriming.maybeLater`** in both locales for the new priming-state link (§1). Suggested copy — en: `'Maybe later'`; he: `'אולי אחר כך'` (the reference's own wording).

`npx jest src/i18n` and `npx tsc --noEmit`.

### Step 5 — Screen 1, `OnboardingScreen` (test first)
Rewrite the spec: drop carousel/dots/skip/next tests; keep and adapt en-copy, he-copy, `onboarding-screen` testID, `onComplete`-fires, CTA-height-token. Add: logo renders, container background, CTA declares the gradient. Add the E7 mock.
```
SafeAreaView          flex:1, backgroundColor: colors.background
  View (content)      flex:1, centered, paddingHorizontal: spacing.xl
    LogoMark          sizing.heroLogo, flexShrink per E11
    Text title        typography.displayLarge, textPrimary, centered, marginTop: spacing['2xl']
    Text body         typography.body, textMuted, centered, marginTop: spacing.md
  GradientButton      testID 'onboarding-primary-cta'
                      marginHorizontal: spacing.md, marginBottom: spacing['2xl']
                      label t('onboarding.getStarted')
```

### Step 6 — Screen 2, `PermissionPrimingScreen`
Keep the priming/denied state machine, the `AppState` listener and the battery-optimization call **exactly as they are**. Then:
- add `IconBadge` (containing a `primary`-tinted `LogoMark`) above the title in both states
- centre title and body (`textAlign: 'center'`), title → `typography.display`, body → `colors.textMuted`
- CTA → `GradientButton` (`radius.lg`, gradient — replacing `radius.md` + flat `primary`)
- **add the "maybe later" link to the priming state** (§1): `testID="permission-maybe-later"`, label `t('permissionPriming.maybeLater')`, `typography.body` in `colors.textMuted`, wrapped to `sizing.minTouchTarget`, firing `onHandled`. Deliberately **not** the reference's `#45643C` — that measures 3.14:1 and fails AA
- the denied state keeps its own `permission-proceed-anyway` unchanged

### Step 7 — Screen 3, `AuthScreen`
Same visual language, no behaviour change: primary CTAs → `GradientButton`; inputs and provider buttons → `colors.surface` fill with `borderStrong` borders; title → `typography.display`; body/labels → `textMuted`; legal disclosure → `textFaint` with `primary` links.

### Step 8 — App shell
Wrap `App.tsx`'s tree in `<SafeAreaProvider>` and add the E4 `StatusBar`. Add the E7 mock to `App.spec.tsx` / `App.auth-gate.spec.tsx` if they fail.

### Step 9 — `App.spec.tsx` (E1) and Maestro flows (E2)

### Step 10 — Native launch backgrounds (E5, E6) — both manual-QA only

### Step 11 — Docs
- `docs/DESIGN_GUIDELINES.md`: **§5** (`displayLarge`), **§6** (`heroLogo`, `iconBadge`), **§9** (Screen 1 is one welcome page; the flow is still Onboarding → Permission → Auth, satisfying §9's "max 3–5 screens"), **§11** (dark mode no longer deferred — the app *is* dark; still no light variant, no theme switching), **§12** (rewrite the palette table as black + navy accent, with §4's contrast ratios).
- `docs/MANUAL_QA.md`: E12 + new items from E5, E6, E10, E11.
- `CLAUDE.md`: update the status paragraph (the palette is now black + navy, Screen 1 is a single welcome page).
- `backlog.md`: add the task, ticked.

### Step 12 — Verify and commit
```bash
cd apps/mobile
npx jest && npm run lint && npm run typecheck
```
`supabase test db` is **not** needed — nothing here touches the database.
Commit to `claude/first-screen-navy-theme-rxh1ff`, then `git push -u origin claude/first-screen-navy-theme-rxh1ff`.

---

## 7. Definition of done

- [ ] `apps/mobile` suite green; count differs from 667 only by deliberate additions/removals
- [ ] `npm run lint` and `npm run typecheck` clean
- [ ] Screens 1–3 share one visual language: black background, centred hero/badge, bold title, muted body, full-width navy gradient CTA
- [ ] Screen 1 is a single welcome page — no carousel, dots, skip, or `next` copy anywhere, **including `App.spec.tsx` and the Maestro flows**
- [ ] Every other screen repainted via tokens alone, with no light-theme remnant
- [ ] **Exactly one behavioural change**, and it is the intended one: the priming-state "maybe later" link. The permission state machine, the `AppState` re-check and the whole OTP flow pass their existing tests unmodified
- [ ] `en`/`he` in parity; no hardcoded strings
- [ ] Docs in Step 11 updated in the same commit
- [ ] Pushed to `claude/first-screen-navy-theme-rxh1ff`

## 8. Explicitly out of scope

- The reference's **pronoun screen and profile/avatar screen** — owner declined; they would need a DB migration and Hebrew gendered-copy decisions
- Running the app or the Maestro flows (no emulator/simulator/Maestro CLI, no device, no Mac)
- Redesigning the app icon (E14) — raise with the owner
- A light-mode variant or theme switching
- New onboarding copy — the dropped `howSessionsWork` / `whyPermissionsMatter` messaging is the owner's product/copy call
