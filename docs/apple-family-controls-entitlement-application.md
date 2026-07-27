# Apple Family Controls Entitlement — Application Draft

Phase 3 task 3.7 (backlog.md). This is text for you to submit yourself —
Apple's request form needs your Developer account/Team ID, and only you can
submit it. Apple's process: developer.apple.com → Account → Certificates,
Identifiers & Profiles → Identifiers → your App ID → check "Family
Controls" under Capabilities, **or** the dedicated request form linked from
Apple's Family Controls documentation page if the capability isn't
self-serve toggleable for your account type. The exact form fields change
over time; the sections below are written to drop into whatever
free-text fields it asks for (app description, use case justification,
API usage description) with minimal editing.

**Before you submit, read the "Know before you submit" section below** —
there's a real framing risk worth understanding, not just a filled-in form.

---

## App description

Lockal Time is a social focus app: a group of people agree to a shared,
time-boxed session (a set duration, or open-ended until the host ends it)
during which distracting app categories are blocked on each participant's
own device. Joining is voluntary and self-directed — every participant
blocks their own phone, for themselves, as a commitment device for a
session they chose to join. There is no remote/parental control of another
person's device; the app has no concept of one user restricting another
user's phone.

- **Bundle ID:** `com.lockaltime.app`
- **Platform:** iOS (native Swift + React Native), Android companion app
  (uses Android's own equivalent OS-level APIs, not part of this request)

## Why Family Controls / ManagedSettings / DeviceActivity specifically

The core feature — blocking a fixed set of distracting app categories
(Social Networking, Games, Entertainment) for the duration of a session —
has no equivalent achievable through public, non-restricted iOS APIs:

- **FamilyControls** (`AuthorizationCenter`, `FamilyActivityPicker`) is the
  only API that lets an app durably restrict *categories* of apps without
  ever learning which specific apps the user has installed — this is a
  deliberate privacy property of the framework we rely on directly: our
  server and our app never learn what's on a user's phone, only that "the
  categories the user picked" are blocked.
- **ManagedSettings** (`ManagedSettingsStore`) is the only way to apply
  that category-level shield.
- **DeviceActivityMonitor** (a separate extension process) is required so
  the shield reliably lifts at the session's scheduled end even if our
  main app is suspended or killed by the system in the meantime — without
  it, a killed app could leave a user's phone shielded indefinitely.

We are not requesting this to build a parental-control or
device-supervision product. Authorization is requested for `.individual`
(self-management), never `.child` — every user manages only their own
device, for a session they explicitly joined.

## Privacy commitments

- No GPS/location data is collected or required.
- The app/server never learns which specific apps a user has installed —
  only the opaque category tokens the user selects once via
  `FamilyActivityPicker`, reapplied on later sessions.
- Blocking is category-level only (a fixed list: Social Networking, Games,
  Entertainment), never a per-app picker exposed to us as data.
- No usage-pattern data (which apps a user tried to open, how often) is
  transmitted off-device; any local violation signals (e.g. permission
  revoked mid-session) affect only that user's own session outcome.

## Know before you submit

Apple's Family Controls entitlement was originally scoped for parental
control / device supervision apps, and review is stricter for apps like
Lockal Time that use it for **self-directed** focus/wellbeing instead —
Apple has publicly broadened eligible use cases to include personal
screen-time/focus tools, but approval is still Apple's judgment call, not
guaranteed, and turnaround can take real time (weeks, not days). If your
submission is rejected or stalled, the honest framing above (individual
self-management, not supervision of another person) is the strongest
argument available — don't be tempted to describe it as a parental-control
app to improve approval odds; that would misrepresent the app's actual
authorization mode (`.individual`) and could cause worse problems (App
Store review rejection for the mismatch) later.

This is also why `CLAUDE.md` and `docs/ARCHITECTURE.md` already treat this
as "development proceeds in parallel as if approved" — the native module is
built and (once a Mac is available) tested via TestFlight/internal builds
regardless of approval timing, with the explicit understanding that App
Store *submission* is blocked until the entitlement lands, not development.
