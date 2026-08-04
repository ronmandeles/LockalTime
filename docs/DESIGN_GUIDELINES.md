# Lockal Time — Design Guidelines

Status: structural design system. Purpose: keep every screen built across separate phases/sessions looking like one coherent product, not a patchwork of one-off decisions. **Color palette landed in Phase 7 (Release Prep)** — see §12; every screen's ad-hoc neutral-grayscale literal was swept to the tokens there (`apps/mobile/src/theme/tokens.ts`'s `colors` export).

Read this before starting any screen-building task, the same way `.claude/skills/` conventions get read before other code tasks.

**Sourcing note:** Instagram, TikTok, and Facebook have never published an official public design system (unlike Apple's Human Interface Guidelines or Google's Material Design) — there is nothing legitimate to "copy" from them. Where this doc aims for the same *appeal/polish* those apps achieve, it draws instead on Apple's actual, public HIG plus credible published UX research on what makes onboarding and micro-interactions feel good — not on those three apps' specific (and largely undocumented) engagement mechanics.

## 0. Two design modes, reconciled

The app has a real tension to manage deliberately, not accidentally: it needs to be **appealing enough that someone opens it instead of Instagram/TikTok in the first place**, while the experience *inside* an active session stays calm and unappealing-to-linger-in. This doc handles both, explicitly scoped:

- **Acquisition surfaces** (Onboarding, Home, Create Session, QR Scan, Completion, History, Stats — Screens 1–5, 7, 10–12): full design effort goes here. Polished micro-interactions, satisfying haptics, confident typography, a strong first-60-seconds onboarding — this is where the app competes for attention against every other app on the phone.
- **In-session surfaces** (Active Session, Emergency Exit — Screens 6, 9): deliberately quieter. Once someone has committed to a session, the UI's job is to get out of the way, not to keep being interesting. No new stimulation is introduced here beyond what's functionally necessary (the timer, the participant list).

This isn't a contradiction of `ARCHITECTURE.md` §9's "restrained gamification" stance — that section governs *reward mechanics* (no variable rewards, no leaderboards) specifically. It doesn't forbid the surrounding UI from being well-crafted and satisfying to use.

## 1. Vibe (the qualitative target)

Calm and uncluttered on in-session surfaces; confident and polished on acquisition surfaces — never busy or cluttered on either. Concretely:
- Generous whitespace over dense layouts. When in doubt, remove an element rather than shrink it to fit.
- Soft, rounded shapes throughout (see radius scale below) — no sharp corners, no aggressive/high-contrast dividers.
- One clear primary action per screen (Home's two-button layout from the original mockup is the reference model — not three competing CTAs).
- Gamification elements stay visually quiet — per `ARCHITECTURE.md` §9, no idle-animating flair, no loud badges. A streak counter should look like a fact being stated, not a prize being dangled. (This is about reward *mechanics*, not about withholding polish — see §0.)

## 2. Spacing scale

One shared scale, used everywhere — no ad-hoc spacing values in any screen:

| Token | Value | Usage |
|---|---|---|
| `space-xs` | 4px | icon-to-label gaps, tight inline spacing |
| `space-sm` | 8px | spacing between related elements (label + input) |
| `space-md` | 16px | default padding inside cards/containers, gap between unrelated elements |
| `space-lg` | 24px | spacing between distinct sections on a screen |
| `space-xl` | 32px | top/bottom screen margins |
| `space-2xl` | 48px | separation for major screen zones (e.g., header vs. content vs. footer action) |

## 3. Corner radius scale

Consistent "curve language" across every component type — this is one of the fastest ways a UI reads as sloppy if left inconsistent:

| Token | Value | Usage |
|---|---|---|
| `radius-sm` | 8px | small elements: chips, tags, badges |
| `radius-md` | 12px | buttons, input fields |
| `radius-lg` | 16px | cards, list items |
| `radius-xl` | 24px | sheets, modals, the large summary cards seen on Home/Completion |
| `radius-full` | 9999px | circular elements: avatars, the QR-scan frame corners, icon buttons |

**Render style:** use continuous ("squircle") corner rounding rather than plain circular corner radius wherever the platform supports it (iOS natively; approximate on Android via a library like `react-native-figma-squircle` if the difference is visually worth it). This is a specific, real Apple HIG detail — continuous corners are why iOS's own icons and cards read as more premium/polished than a plain `border-radius` — and it's free to adopt since RN styling doesn't care which corner algorithm produces the curve.

No component invents its own radius value outside this set.

## 4. Elevation (shadow) scale

Two levels only — resist adding more, it's a fast way to make a "calm" UI look busy:

| Token | Usage |
|---|---|
| `elevation-0` | flat — most surfaces (screen background, inline cards on a plain background) |
| `elevation-1` | subtle shadow — floating/actionable elements only: the primary CTA buttons, the active-session timer card, modals/sheets |

## 5. Typography scale

A fixed ramp, not per-screen font-size choices. **Typeface: use the OS system font** (San Francisco on iOS, Roboto on Android — RN's `System` font family gives this automatically per-platform, no custom font files needed). This is a direct Apple HIG recommendation (San Francisco is engineered specifically for on-screen legibility) and the pragmatic cross-platform default.

| Token | Size | Weight | Usage |
|---|---|---|---|
| `text-display-large` | 34px | Bold | The onboarding welcome headline **only** — one step above `text-display`, which remains the largest size any in-app screen uses |
| `text-display` | 28px | Bold | Big numbers: points totals, the countdown timer; the Permission and Auth screen titles |
| `text-heading` | 20px | Semibold | Screen titles, section headers |
| `text-body` | 16px | Regular | Default reading text |
| `text-body-strong` | 16px | Semibold | Emphasized inline text (e.g., a bonus percentage in a receipt) |
| `text-caption` | 13px | Regular | Secondary/supporting text, timestamps, helper text |

Line height: 1.4× the font size across all tokens, no exceptions, for consistent vertical rhythm. Support Dynamic Type / Android font scaling — don't hardcode pixel sizes in a way that breaks with the user's OS text-size setting (an explicit HIG accessibility requirement).

## 6. Component sizing standards

| Element | Standard |
|---|---|
| Minimum touch target | 44×44pt (iOS HIG) / 48×48dp (Android) — the stricter of the two platform minimums, applied everywhere, including icon-only buttons |
| Primary button height | 52px |
| Input field height | 48px |
| Icon size (standard) | 24px |
| Icon size (large, e.g., tab bar) | 28px |
| Avatar size (participant list) | 36px, `radius-full` |
| Hero logo (onboarding welcome) | 160px, `radius-full` — a **maximum**, capped against window height on short screens so the pinned CTA can't be pushed off |
| Icon badge (permission priming) | 100px circle, `radius-full`, filled `primarySubtle`, holding a glyph at roughly half its diameter |

## 7. Motion & micro-interaction principles

General rules (specific interactions like the QR-scan checkmark morph or the countdown ring's color shift are described in `ARCHITECTURE.md`'s UX notes — these are the rules that govern *all* of them):
- Standard transition duration: 200–250ms for in-screen state changes, 300–350ms for screen-to-screen navigation. Nothing should feel instant-snap or sluggish.
- Easing: ease-out for elements entering/appearing, ease-in for elements leaving/dismissing — never linear, which reads as mechanical.
- A micro-interaction's job is to **reduce hesitation and confirm the system understood the action** — e.g., a button should visibly respond within one frame of being pressed, before the async result comes back. This is what makes an interface feel trustworthy and responsive rather than decorative.
- Animate state changes, never animate for decoration. If removing an animation wouldn't lose any information (a pulsing icon with no state behind it), don't add it — this is the same principle as `ARCHITECTURE.md` §9's stance against idle-animating gamification elements.
- High-stakes actions (Emergency Exit) get deliberately *slower*, effortful interactions (long-press/slide-to-confirm) — motion should communicate weight, not just look polished.
- Gestures are always paired with haptic feedback (see §8) — never a silent gesture on either platform.

## 8. Haptic feedback taxonomy

A fixed, deliberate mapping — not sprinkled in ad hoc. iOS exposes this natively via `UIImpactFeedbackGenerator`/`UINotificationFeedbackGenerator`; `react-native-haptic-feedback` exposes equivalent types on Android in a bare-workflow project (no Expo dependency needed).

| Type | Trigger examples |
|---|---|
| Light impact | Toggling a control, incrementing session duration on Create Session |
| Medium impact | Starting a session, confirming a join |
| Heavy impact | Reaching the Emergency Exit confirmation threshold (slide/long-press completes) |
| Success notification | QR scan recognized, session completed, milestone reached |
| Warning notification | Approaching the offline 30-minute cutoff, host-migration toast appearing |
| Error notification | QR invalid/expired, join rejected (capacity/attestation failure) |

## 9. Onboarding-specific rules

Applies to Screens 1–3. Grounded in current published UX research on first-session retention, not invented for this project:
- **Maximum 3–5 screens** before reaching a meaningful first action (matches our existing 3: Onboarding → Permission → Auth).
- **Screen 1 is a single welcome page**, not a carousel. It was three swipeable pages with pagination dots and a skip link; the owner's call was that a first impression should be one clear statement rather than three, and the two dropped pages' copy ("how sessions work", "why permissions matter") was removed from the locale bundles rather than left orphaned. Where that messaging should reappear is an open product/copy question.
- **Screens 1–3 share one visual language**: pure-black page, a centred hero mark or icon badge, a bold centred title, muted centred body copy, and a full-width navy-gradient CTA pinned near the bottom (`GradientButton`).
- **Get to a first meaningful action within ~60 seconds** of first open — for us, that's landing on Home with a clear "Create Session" / "Scan QR" choice, not a longer tour.
- Each onboarding screen should earn its place by resolving one specific hesitation (why permissions are needed, why to sign up) — not by explaining the whole product.

## 10. Cross-platform consistency rule

iOS and Android share the exact same tokens above — React Native's shared styling makes this the default, not something either platform should diverge from without a specific, documented native-platform reason (e.g., respecting a platform-specific safe-area inset is fine; picking a different corner-radius scale per platform is not).

## 11. Open / deferred

- Light mode — **the app is now dark** (§12: pure black with a navy accent), and that is its only appearance. There is still **no theme-switching infrastructure and no light variant**: the palette does not respond to the OS theme setting, and every screen renders the same values regardless of it. A light variant would mean threading a theme through every screen that currently imports tokens directly — a real piece of work, not a token swap. Revisit if/when it comes up.

## 12. Color palette

**Pure black with a navy-blue accent.** The app went dark in one pass after
Phase 7's light teal palette shipped; only the token **values** changed, and
every token kept its name and semantic role. That is what made a whole-app
repaint a one-file change: no screen holds a hex literal, so all 17 of them
followed these values into dark mode without an edit.

All of it lives in `apps/mobile/src/theme/tokens.ts`'s `colors` export —
screens import from there, never a raw hex literal. `tokens.test.ts` pins the
exact values **and computes the contrast ratios below**, so a value nudged
past WCAG AA fails the suite rather than merely contradicting this table.

**Surfaces** — neutral greys on true black. The accent carries all the colour;
the surfaces stay deliberately colourless.
| Token | Value | vs `background` | Use |
|---|---|---|---|
| `background` | `#000000` | — | Page background |
| `surface` | `#1C1C1E` | 1.23 | Cards, summary blocks, inputs, provider buttons, dialogs |
| `surfaceActive` | `#2C2C2E` | 1.51 | Pressed/active state of a surface element |
| `border` | `#2C2C2E` | 1.51 | Dividers, subtle borders |
| `borderStrong` | `#3A3A3C` | 1.85 | Input borders, dialog edges, more visible dividers |
| `black` | `#000000` | — | Camera viewfinder letterboxing only — a technical necessity, not part of the semantic scale. It now happens to equal `background`; the two roles stay separate |

**Text** (strongest to most muted). Every one clears WCAG AA (4.5:1) against
**both** `background` and `surface`.
| Token | Value | vs `background` | vs `surface` | Use |
|---|---|---|---|---|
| `textPrimary` | `#FFFFFF` | 21.00 | 17.01 | Titles, primary values, strong emphasis |
| `textSecondary` | `#C7C7CC` | 12.47 | 10.10 | Body copy |
| `textMuted` | `#8D8D92` | 6.36 | 5.15 | Captions, secondary labels, onboarding body copy, escape-hatch links |
| `textFaint` | `#86868C` | 5.80 | 4.70 | Lowest-emphasis text (e.g. the legal disclosure) |
| `placeholder` | `#8A8A8F` | 6.11 | 4.95 | Input placeholder text |

**Brand accent** — navy blue, deliberately **brightened** from a true navy
(`#1B2A6B` family): on black, a true navy is too low-contrast to work as a
button fill. Used for CTA fills, selected/active states, progress fills, and
inline links — **never** for plain body text.
| Token | Value | vs `background` | White label | Use |
|---|---|---|---|---|
| `primary` | `#3563D8` | 3.93 | 5.35 | Active/selected state, progress fill, inline links |
| `primaryPressed` | `#2A50BC` | 2.97 | — | Reserved; **no caller**. Unconstrained by design — a pressed state is only visible while a finger covers the control |
| `primaryGradientStart` | `#2F5BD0` | 3.53 | 5.95 | CTA gradient, left end |
| `primaryGradientEnd` | `#3B6FE0` | 4.54 | 4.63 | CTA gradient, right end |
| `primarySubtle` | `#0C1428` | 1.15 | — | Icon-badge fill (the accent at ~12% over black) |
| `onPrimary` | `#FFFFFF` | — | — | Text/icon colour on a `primary`-filled surface |
| `link` | `#5B8AF0` | 6.34 | — | Inline text links. The accent again, lightened until it is legible **as text** |

> `primary` is used **only** as a fill or border, never as text, so WCAG's 3:1
> non-text rule applies rather than 4.5:1. **Words get `link` instead** —
> `primary` measures 3.93:1 on black, which is fine behind a button and below
> the bar for text. This distinction is enforced, not merely written down:
> `text-color-usage.test.ts` reads every screen and component source and
> fails if a fill-only token appears as a `color:`. It exists because the
> repaint made exactly this mistake once, and the suite stayed green.
>
> The gradient is squeezed from **both** sides: too dark and the button's edge
> stops being perceivable against black (WCAG 1.4.11, 3:1); too light and the
> white label fails AA. Both ends clear both bars — that is the whole reason
> this pair of values is what it is.

**Semantic** — lightened for a dark surface; the previous values (`#B00020`
etc.) are unreadable on black.
| Token | Value | vs `background` | vs `surface` | Use |
|---|---|---|---|---|
| `danger` | `#FF6B7A` | 7.64 | 6.19 | Error text |
| `warning` | `#F0A34A` | 10.04 | 8.14 | Attention-worthy-but-not-fatal states (e.g. `StatusBanner`'s "prominent" weight) |
| `success` | `#4ADE80` | 12.05 | 9.76 | Reserved — no caller yet |

**Overlay**
| Token | Value | Use |
|---|---|---|
| `overlay` | `#000000CC` | Semi-transparent dialog scrim |

**The CTA gradient.** The onboarding flow's primary button is a
left-to-right gradient between `primaryGradientStart` and
`primaryGradientEnd`, rendered by React Native's built-in CSS gradient
support (`experimental_backgroundImage`) rather than a native gradient
package — no Podfile or Gradle change, and no risk to the macOS iOS build
job, for one button. It lives in exactly one component
(`src/components/GradientButton.tsx`), so the `experimental_` prefix is a
single-file liability if a future RN upgrade renames it. **The gradient does
not mirror under RTL** — a gradient is a paint instruction, not layout, so
React Native will not flip it, and branching a style on locale is forbidden
(`.claude/skills/i18n/SKILL.md`). The direction is `to right`
unconditionally; judging the asymmetry on a real RTL device is a manual-QA
item.

**Two surfaces the palette does NOT reach.** The OS paints both before React
Native mounts, so neither can read a JS token: iOS's launch storyboard
(`ios/LockalTime/LaunchScreen.storyboard`) and Android's window background
(`android/app/src/main/res/values/{colors,styles}.xml`). Both are set to
black by hand and pinned by `__tests__/native-config.test.ts`; keeping them
in sync with `background` is a manual obligation.

There is no light variant and no theme switching (§11) — these are the only
values, used identically regardless of the OS theme setting.
