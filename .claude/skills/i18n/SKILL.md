---
name: i18n
description: i18next/RTL stack, no-hardcoded-strings rule, typed locale parity, and RTL-safe layout rules. Read before building any screen or adding user-visible text.
---

Read before building any screen or adding any user-visible string. English + Hebrew from day one, full RTL support, no hardcoded UI strings — all three are locked decisions (`CLAUDE.md`); the enforcement layers below make them permanent.

## Stack (locked)

`i18next` + `react-i18next`, device-locale detection via `react-native-localize`, RTL via RN's `I18nManager`. Hebrew is the RTL locale. All of it sits behind `apps/mobile/src/i18n/` — screens import from there, never from the libraries directly (`useTranslation` from `react-i18next` is the one allowed direct import in components).

## No hardcoded UI strings

- Every user-visible string renders via `t('...')`. No literals in JSX text or user-facing props.
- Enforced at lint time: `i18next/no-literal-string` (eslint-plugin-i18next) runs in `error` mode on `apps/mobile`, validating JSX text plus the user-facing attribute include-list (`accessibilityLabel`, `accessibilityHint`, `placeholder`, `title`, `label`). Add new user-facing props to that include-list in `.eslintrc.js` when a component introduces them. Non-copy attributes (`testID`, navigator route names) are intentionally out of scope. Test files are excluded via overrides — specs assert against literals by design.
- Enforced at test time: rendering under the `he` locale and asserting Hebrew copy appears (see `HomeScreen.spec.tsx`) proves a screen is actually wired through i18n.

## Typed locale modules (the parity guarantee)

- Translation resources are TS modules, not JSON: `src/i18n/locales/en.ts` is canonical and exports `TranslationSchema = typeof en`; every other locale is declared `const xx: TranslationSchema = {...}`. A missing or extra key anywhere is a compile-time error.
- `locale-parity.test.ts` re-checks parity at runtime (and catches blank values) as the guard that survives any future typing loosening.
- Key naming: nested by screen/domain (`home.title`, `createSession.durationLabel`), camelCase segments, leaf values are strings. No top-level flat keys.
- Adding a key means adding it to **every** locale in the same commit — the type error and the parity test both enforce this; never placeholder it with an empty string (the parity test rejects blanks).

## Locale detection & direction

- `resolveDeviceLocale` (pure) maps `getLocales()` preferences to a supported locale; `en` is the fallback. It keys off `languageCode` only and normalizes Android's legacy `iw` → `he`. Extend the supported set there and only there.
- `syncLayoutDirection(locale)` is the **sole** `I18nManager` touchpoint in the codebase. Screens never import `I18nManager`. Layout direction follows the resolved app locale, not the raw device setting.
- `I18nManager.forceRTL` takes effect on the **next app start** — a real device-language switch is a manual QA item, not JS-testable.
- `initI18n()` creates a fresh instance per call (no module-level singleton); the App bootstrap owns the live instance, gates rendering until it's ready (never flash raw keys), and hands it to `I18nProvider`.

## RTL-safe layout rules

Binding for every style and layout, from the first line of any new screen:

- Use logical properties only: `marginStart`/`marginEnd`, `paddingStart`/`paddingEnd`, `start`/`end` for absolute positioning — never `marginLeft`/`marginRight`/`left`/`right`. RN flips logical properties automatically under RTL.
- `textAlign`: rely on the default (which follows layout direction); prefer omitting it entirely. Never hardcode `'right'` to fake RTL, and only use `'left'`/`'right'` when the content is genuinely direction-fixed (e.g. numerals in a code display).
- `flexDirection: 'row'` flips automatically under RTL — design row layouts so that flipping is correct (it almost always is); never pre-reverse a row for Hebrew.
- No direction-dependent absolute positioning (e.g. pinning a badge with `left: 8`) — use `start`/`end`.
- Icons that imply direction (back arrows, chevrons, "next" indicators) must flip under RTL: render them with `transform: [{ scaleX: I18nManager.isRTL ? -1 : 1 }]` via a shared helper/component when the first such icon lands — not ad hoc per screen. Icons that don't imply direction (clock, QR) never flip.
- Never branch layout on locale (`locale === 'he'`) — branch on nothing; write direction-neutral styles and let `I18nManager` do the flipping.
- **A glyph drawn out of borders is the one exception to "logical properties only", and it must say so in a comment.** `BlocklistPicker`'s expand chevron is a square with `borderBottomWidth` + `borderRightWidth` rotated 45°. Physical edges are deliberate there: it points *down* ("opens"), which is direction-neutral and must look identical in Hebrew, whereas logical edges would swap which two sides carry the border and rotate the arrowhead into a different direction. The rule stays "logical properties for layout"; a rotated border-glyph is not layout. Never "fix" one into `borderEndWidth` without re-checking it under RTL.

## Testing conventions

- Mock `react-native-localize` (`jest.mock('react-native-localize', ...)`) in every suite that touches i18n init — no test may read the machine's real locale (determinism rule, [[testing-standards]]).
- Component specs assert against the locale modules (`en.home.title`), never re-typed string literals, so copy edits don't break specs.
- Spy on `I18nManager` methods in any suite that renders `App` so tests can't mutate real layout state.
