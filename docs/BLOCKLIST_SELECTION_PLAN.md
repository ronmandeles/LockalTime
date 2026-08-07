# Host-selected blocklist — implementation plan

**Status:** planned, not started. Agreed with the owner 2026-08-07.
**Reverses:** `docs/ARCHITECTURE.md` §4's "fixed set of default categories… not a
per-session or per-user app picker" and `docs/DATABASE.md`'s
`BLOCKED_APP_CATEGORIES` row. Both are wrong once this lands and must be
rewritten as part of it.

---

## 1. What we're building

Today every session blocks the same three categories, hardcoded in
`apps/mobile/src/config/blocked-categories.ts`. This makes the blocklist a
per-session choice made by the host on the Create Session screen.

The host names **what** to block. Each member's device resolves that name
against its own installed apps. Two kinds of name:

| Kind | Example | Meaning |
|---|---|---|
| Category | `social` | every app on *that* device declaring itself social |
| App | `com.instagram.android` | that specific app, on devices that have it |

Host picks "Social" → a member with Instagram and WhatsApp loses both; a member
with neither loses nothing. Host picks Instagram and TikTok → a member with only
Instagram loses only Instagram.

Both kinds are plain strings, which is the whole reason they can travel between
phones.

### Behavioural difference worth surfacing in the UI

A **category** automatically covers apps installed later. A **specific app list**
does not — install a new game mid-session and it isn't blocked. Neither is wrong;
the host should be told so they choose deliberately.

---

## 2. Platform reality (researched 2026-08-07, sources at the end)

The semantics above are fully deliverable on Android. iOS constrains them, and
the constraint is architectural, not a gap in our implementation.

Apple's Screen Time API represents an app as an opaque `ApplicationToken`. It
**cannot be constructed from a bundle id**, cannot be read back into one, and
cannot be transferred between devices. An Apple engineer's accepted forum answer:

> "Due to privacy restrictions, bundle IDs are only available in the
> `ShieldConfigurationDataSource`. Otherwise they are nil / not provided."

`ActivityCategoryToken` has the same property — Apple's `FamilyActivityPicker` on
that specific device is the only source. So a string arriving from our server has
nothing to bind to on an iPhone.

### What this does and doesn't break

| Case | Result |
|---|---|
| Solo session, Android | **Exact.** Fully automatic |
| Solo session, iOS | **Exact**, after the host confirms their own selection in Apple's picker |
| Group session, Android member | **Exact.** Fully automatic — package names and categories resolve locally |
| Group session, iOS member | **Exact, but manual** — they confirm in Apple's picker at join |

The iOS flow is the owner's design (2026-08-07): Session Details (Screen 8)
describes the session's blocklist before joining, and tapping Join presents
Apple's picker so the member selects those items on their own device. Their phone,
their tokens. Every iOS participant does this, host included — see §7.

### An iOS host picks from the catalog, not from Apple's picker

Apple's picker yields opaque tokens, so a host who chooses apps there has nothing
to write into `blocked_packages` — nothing would reach other members.

**Why we cannot read the picker even though it renders inside our app:** iOS draws
it in a separate process and composites the result into our window. Our code gets
the rectangle, never the contents — a programmatic screenshot of our own app
returns that region blank. Same architecture as Apple Pay sheets and the photo
picker. `Label(token)` will *render* the real name and icon on the host's own
screen, but never hands us the string. Display on this device: yes. Extract as
data: no.

So an **iOS host selects from our curated catalog** (§6) instead: a list of
well-known apps we ship, each carrying the package name used as the cross-device
identity. Picking "Instagram" stores `com.instagram.android`, which travels
normally.

Apple's picker still runs on iOS, at a different moment and for a different job:
**confirming**, not choosing. See §7.

Limitation: an iOS host can only share apps present in the catalog. A niche app
can still be blocked on their own device via the confirm step, but cannot be
imposed on the session.

### Known iOS limitation to document, not solve

iOS reissues `ApplicationToken`s unpredictably — widely reported, and reported
again as an iOS 26 regression. Any design storing a token↔identity map goes stale
silently. This plan stores no such map, so the failure mode is limited to a
member's own selection needing re-picking. Belongs in `docs/ARCHITECTURE.md` §4
next to the Safe Mode limitation.

---

## 3. Data model

Two array columns on `sessions`, not JSONB and not a join table: the list is
always read as a unit, never queried independently, and bounded at ~53 short
strings. Arrays keep CHECK constraints and array operators available, which JSONB
would cost.

```sql
alter table public.sessions
  add column blocked_categories text[] not null default '{social,games,entertainment}',
  add column blocked_packages   text[] not null default '{}';

update public.sessions set blocked_categories = '{social,games,entertainment}';

alter table public.sessions
  add constraint chk_blocked_categories_valid
    check (blocked_categories <@ array['social','games','entertainment']),
  add constraint chk_blocklist_non_empty
    check (cardinality(blocked_categories) + cardinality(blocked_packages) > 0);
```

Backfill precedes the constraint so existing rows survive. The column default
reproduces today's behaviour, so any path not yet updated keeps working.

`grant select on table` is table-wide and covers later-added columns, so no grant
change is needed — worth one pgTAP assertion to prove it rather than assume it.

### Venue sessions carry an approved blocklist

*Owner decision 2026-08-07.* A `static_qr` venue session seats up to 200 strangers
and the business chooses what they block — nothing otherwise stops a café blocking
a competitor's app. So a venue's blocklist is **approved out of band**, matching how
Verified Host itself is granted today (a manual flag in Supabase, no in-app flow —
ARCHITECTURE §10):

```sql
alter table public.venues
  add column approved_blocked_categories text[] not null default '{social,games,entertainment}',
  add column approved_blocked_packages   text[] not null default '{}';
```

A `static_qr` session's blocklist must be a **subset** of its venue's approved
arrays; the server rejects anything else. A new venue defaults to the three
categories, which is today's behaviour — so a business is useful immediately and
only needs the owner's attention if it wants specific apps.

This stays inside the "manual flag for now, V2 for a real application flow"
position CLAUDE.md already records for B2B. It does not settle B2B monetization.

**Future kind:** iOS also supports `webDomainTokens`. If website blocking is ever
wanted, it's a third column, not a remodel.

---

## 4. Server

| Endpoint | Change |
|---|---|
| `POST /sessions` | accepts `blocked_categories`, `blocked_packages` |
| `POST /sessions/preview` | returns both, so Screen 8 can describe the session pre-join |

Zod at the boundary (`.claude/skills/api-design/SKILL.md`): categories from the
enum, packages against a package-name pattern
(`^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)+$`), combined length ≥ 1,
capped at 3 categories and 50 packages to bound the payload.

Plus two server-side rejections that do not depend on the client behaving:

- **Safety denylist** — well-known dialer, SMS, Settings and our own package are
  refused at the boundary, not only filtered out of the picker. Honest limit: the
  *default* dialer is device-specific, so the server can only cover well-known
  identifiers and the device-accurate check stays client-side (§8). Belt and
  braces, not a complete guarantee.
- **Venue subset check** — a `static_qr` session's blocklist must fall inside its
  venue's approved arrays (§3).

*Owner decision 2026-08-07:* pattern-match rather than catalog-only. The string is
never executed, never a path, never interpolated into SQL — it is only ever
compared on-device — so the injection surface is nil, and catalog-only would cap
Android hosts at catalog apps and undo the full-enumeration choice. The real risk
is a host blocking someone's phone app, which the denylist above addresses
directly.

**Honest framing of the non-empty rule:** it is an accident-guard, not an
anti-abuse control. A host determined to game it can select one obscure app they
don't have. It exists so nobody *accidentally* creates a session that blocks
nothing while paying 1pt/min. Real anti-abuse here would need server-verifiable
enforcement, which neither platform offers.

---

## 5. Client hydration

`fetchSession` in `apps/mobile/src/services/session-repository.ts` selects an
explicit column list (line ~69). Add both columns there and to `SessionRow`, and
an already-joined client picks up the blocklist on hydrate and on relaunch. No new
endpoint.

---

## 6. The app catalog, and why only package names cross between users

A bundled catalog of well-known apps — package name plus display name, one JSON
file, no permissions — does three jobs, in descending order of importance:

1. **It is the only way an iOS host can name an app at all** (§2). Without it,
   specific-app selection simply does not exist for iOS hosts.
2. **It keeps host-supplied text off other people's screens.** It would be easy
   to send `{ id, label }` so members see "Instagram" rather than
   `com.instagram.android`. **Don't** — that is host-controlled text rendered on
   strangers' phones, and a venue session seats up to 200 people
   (`VENUE_SESSION_MAX_PARTICIPANTS`). With a catalog, the receiving device
   resolves the name from its own copy, so nothing a host types ever travels.
3. **It is the fallback if Google refuses `QUERY_ALL_PACKAGES`** (§10).

So the wire format stays package names only. Display names are resolved on the
receiving device: Android from its own `PackageManager`, iOS from the catalog,
falling back to the raw package name for anything unknown.

### Catalog shape

```jsonc
{
  "id": "com.instagram.android",   // the cross-device identity, also the Android package
  "name": "Instagram",             // display, resolved locally — never sent
  "category": "social",
  "iosScheme": "instagram"         // optional, for the installed-check below
}
```

### Filtering the iOS list to apps the host actually has

iOS offers no enumeration, but it does answer one narrow question per app:
`UIApplication.canOpenURL("instagram://")` effectively reports whether Instagram is
installed. Each scheme must be declared in `Info.plist`'s
`LSApplicationQueriesSchemes`, and **Apple caps that list at 50 entries** — it is
twenty questions, not a directory listing.

That is enough to filter the catalog down to roughly what the host really has, so
the iOS picker reads as "your apps" rather than "popular apps". Catalog entries
beyond the 50 declared schemes, or apps that publish no scheme, are shown
unfiltered — harmless, since blocking an app the host doesn't own simply has no
effect on their device and still blocks correctly for members who do.

Pick the 50 schemes by expected blocking frequency, and treat the list as a
tunable constant, not a hardcode.

*Corrected 2026-08-07 (owner):* an earlier draft cut this catalog, having judged
it on job 3 alone and called it cosmetic. Job 1 makes it structural — without it
the iOS host flow has no shareable identity to produce.

---

## 7. Mobile UI

### Create Session (Screen 5)

New section below session type:

- Three category toggles, reusing the existing toggle styles on that screen.
- A specific-app list with checkboxes, fed by a **source seam**:
  - **Android** — the host's actually-installed apps (`InstalledAppsModule`, §8).
  - **iOS** — the bundled catalog (§6), filtered by `canOpenURL` probing so it
    reads as the host's own apps for the ~50 most common ones.
- Pre-filled from the user's last choice, editable per session (persisted
  client-side, following `active-session-store.ts`'s pattern).
- Submit blocked with a message if nothing at all is selected.
- **Verified host on `static_qr`:** the list is narrowed to the venue's approved
  entries (§3), with a note explaining why rather than silently showing less.
- **"You don't have 2 of these"** — a quiet note when the host selects apps not
  installed on their own device (*owner decision 2026-08-07*). Detectable on
  Android always, and on iOS only within the ~50 probed schemes, so its absence
  proves nothing on iOS. Harmless either way: an app the host lacks is a no-op for
  them and still blocks correctly for members who have it.
- **List performance and a11y:** ~200 rows needs `FlatList` virtualization, not a
  `map()` into a `ScrollView`. Each row carries `accessibilityRole="checkbox"` and
  `accessibilityState={{ checked }}`, matching how the existing toggles on this
  screen are already annotated.
- **Bidi:** Latin app names sit inside Hebrew sentences on this screen. Names go in
  their own `Text` node rather than interpolated into a sentence, so the bidi
  algorithm can't reorder punctuation around them (i18n skill).

The seam is what makes both platforms one component, and it doubles as the
`QUERY_ALL_PACKAGES` mitigation (§10) — a refusal swaps Android onto the same
catalog iOS already uses, with no UI change.

An iOS host still needs the confirm step below for their *own* device, since
choosing from the catalog produces a shareable name but no Apple token.

### Session Details (Screen 8) — the confirm step

Already the participant's pre-join confirmation and already fetching a preview.
Add "This session blocks: Social, Games, Instagram."

- **Android** — Join proceeds directly; the device resolves everything itself.
- **iOS** — Join presents Apple's picker so the member selects the listed
  categories and apps on their own device, minting their own tokens. This is the
  only moment an iOS device can acquire them.

**This is a re-selection, not a confirmation dialog.** The member finds and taps
each item in Apple's sheet themselves, using its search field. We cannot pre-tick
the items for a first-time selection, because pre-ticking needs the tokens and not
having them is the entire reason the step exists. Roughly 15–20 seconds for three
items. Android members skip all of it.

Two things reduce the friction:

**Instruction text inside Apple's sheet.** `FamilyActivityPicker` accepts header
and footer text, so "Select: Instagram, TikTok" renders inside Apple's own UI —
the member isn't working from memory of the previous screen.

**Selection cache — skip the picker on a repeat blocklist.** On completing a
selection, persist it in the App Group *paired with the blocklist string it was
made for*. A later session whose blocklist matches that string reuses the saved
selection and never presents the picker. This reads no tokens; it only remembers a
pairing we ourselves created.

The cache is keyed on the **whole blocklist**, so `[social, instagram]` reuses,
while `[social, instagram, tiktok]` is a different key and re-prompts.

*Owner decision 2026-08-07: cache with no periodic re-prompt.* The accepted risk is
token rotation (§2) — a stale cached selection can silently shield nothing, and we
cannot detect it, which fails in the under-blocking direction. Logged here as an
accepted limitation alongside Safe Mode and the suspended-app cutoff, not as a
solved problem. A periodic re-prompt was offered and declined.

### Per-app token learning by subtraction

*Owner decision 2026-08-07: build it.* `ApplicationToken` and
`ActivityCategoryToken` are opaque but `Hashable`, so set arithmetic works on them
even though their contents don't. That is enough to learn which token is which
without ever asking the user to tag anything.

Keep a map in the App Group: `"com.instagram.android" → ApplicationToken`,
`"social" → ActivityCategoryToken`. Then at join:

| Map covers the session's blocklist | Behaviour |
|---|---|
| Fully | Compose the selection from the map. **No picker at all.** |
| All but one item | Pre-seed the picker with the known tokens, header text naming the missing one. The user adds it; `newSet − oldSet` is that item's token. **Learn it.** |
| Missing two or more | Present the picker for the whole list, cache the result per-combination (above), learn nothing |

**The one-unknown restriction is a correctness requirement, not caution.** If two
items are unknown, the difference is a set of two tokens with no way to tell which
is which — guessing would poison the map permanently. Falling back to
combination-caching keeps it sound, and the map still fills naturally as people add
one app at a time.

Once an app is in the map it is never asked for again, in any combination.

**Accepted risk, unchanged:** rotation (§2) corrupts map entries silently, and this
spreads the exposure across more entries than a single cached selection would.
Undetectable by design — `ManagedSettingsStore` doesn't report that a token no
longer resolves. Expiring map entries after N days would bound it, but that is a
periodic re-prompt by another name, which the owner declined above. Noted as an
available lever if rotation turns out to bite in the field.

We also cannot verify the member picked correctly. Like every client-side blocking
signal in this app, the server never treats it as trusted (`use-app-blocker.ts`
header, ARCHITECTURE §5/§8).

### Active Session (Screen 6)

*Owner decision 2026-08-07: full list, expandable.* A compact summary near the
timer — "Blocking: Social, Games +2" — opening into the complete list on tap. The
pre-join screen is easy to forget an hour in, and someone who hits a block wants to
know why.

Read-only. It is the same session-scoped list already hydrated by `fetchSession`
(§5), so no new fetch. De-duplicate category/app overlap here too (§9).

`markBlockerReady` gates the Group Bonus (`use-app-blocker.ts` ~line 64), so on
iOS it fires after the picker closes, not on tap. Cancelling the picker means not
joining.

---

## 8. Native

### Android — new `InstalledAppsModule`

`getInstalledApps()` → package name, label, category. Requires
`QUERY_ALL_PACKAGES` plus a Play Console declaration (§10).

**Icons are a separate call, windowed.** *Reviewed and corrected:* an earlier draft
returned base64 icons inline with the list. ~200 apps × a 96px PNG is 1.5–3 MB of
base64 across the RN bridge in one synchronous payload — it will jank. Fetch icons
for the visible window only, via `getIcons(packageNames)`, decoded off the main
thread and cached. A native view rendering the `Drawable` directly (zero bridge
transfer) is the better long-term answer if windowing proves insufficient.

### Android — enforcement

`BlockerForegroundService.kt` gains a `blockedPackages` set; the poll becomes
`pkg in blockedPackages || categoryOf(pkg) in blockedCategories`. `BootPersistence`
must persist packages too, or a reboot resumes mid-session with a partial
blocklist.

**The overlay copy has to change.** It is one generic string today
(`blocker_notification_text`) and should name what it blocked. Two consequences the
plan previously missed: it needs a Hebrew counterpart in the Android string
resources, and the overlay currently has **no i18n path at all** — it is a bare
`TextView` built in Kotlin, outside i18next. Either add proper
`values-iw/strings.xml` resources or pass the resolved copy in through `start()`.
The second keeps one translation source of truth and is probably right.

### The `shield_triggered` event needs a wider shape

`BlockerEvent`'s `shield_triggered` carries `category: BlockedCategory`
(`app-blocker.ts` ~line 47). A block triggered by a *package* has no valid value
for that field. It becomes something like
`{ reason: 'category', category } | { reason: 'package', packageName }`, with
`toBlockerEvent`'s boundary validation widened to match — it currently rejects any
payload whose `category` isn't one of the three known strings, so a
package-triggered event would be silently dropped today.

Purely a UI-hint event, never trusted for points (ARCHITECTURE §5/§8), so this is
a typing and validation change rather than a trust-boundary one.

### iOS

No token-model change. The host picks on their phone, members pick on theirs,
`AppBlockerModule.swift` applies whatever selection is saved.

### Safety exclusions (both platforms)

Never blockable, never shown in the picker: the default dialer (resolved via
`TelecomManager`), the default SMS app, Settings, and our own package. Filtering to
apps with a launcher intent also drops most system services.

---

## 9. Edge cases

| Case | Handling |
|---|---|
| Nothing selected | Server rejects; submit disabled with a message |
| Member lacks a blocked app | Nothing happens — correct behaviour |
| App installed mid-session | Category covers it, app list doesn't; surface in UI |
| Blocklist edited mid-session | Frozen for everyone, including a promoted host (§9a). The saved *default* is client-side and the running session reads from the server, so editing the default can't leak into a live session |
| Reboot mid-session | Covered once `BootPersistence` carries packages |
| Host migration / rejoin | Session-scoped, survives both unchanged |
| Pre-existing sessions | Column default reproduces today's behaviour |
| iOS host picks specific apps | Chosen from the catalog (shareable), then confirmed in Apple's picker for their own device (§7) |
| iOS user cancels the picker at join | Not joined. No half-joined state, and no `markBlockerReady` |
| iOS repeat session, same blocklist | Cached selection reused, no picker (§7) |
| iOS repeat session, blocklist changed | Different cache key, picker re-presented |
| Cached iOS selection gone stale via token rotation | Undetectable; accepted limitation (§7) |
| Host picks an app absent from the catalog | Android-host only; an iOS host cannot name it (§2) |
| Category and explicit app overlap | Pick `social` + `instagram` and Instagram is in both. Harmless for enforcement; the verifying screen must de-duplicate so it isn't listed twice |
| Venue with nothing specifically approved | Defaults to the three categories — today's behaviour, useful immediately (§3) |
| Venue host selects outside the approved set | Server rejects; the picker shouldn't have offered it, so this is the boundary catching a stale client |
| Host has none of the apps they picked | Allowed, with the note in §7. They are choosing for the group, not themselves |

### 9a. The blocklist is frozen for the session's lifetime

*Owner decision 2026-08-07.* Nobody can change a running session's blocklist —
not the original host, not a host promoted by migration.

This closes an exploit rather than merely simplifying: migration promotes whoever
has the **most minutes present** (ARCHITECTURE §6), which a group can arrange
deliberately. An editable blocklist would let them hand the role to a confederate
who unblocks everything while everyone keeps earning.

**Forward compatibility — premium add-only editing.** The owner intends a future
premium tier that can *add* apps to a blocklist. Adding is safe by the same
principle used for iOS throughout this plan: over-blocking never buys anyone points
they didn't earn, only under-blocking does. So build the freeze as a **policy, not
a structural assumption**:

- Keep the blocklist a mutable session column, not an immutable creation-time value.
- Leave room for a mid-session re-push path — a config change has to reach every
  device and restart the native blocker with it, which is the real work in that
  feature and the thing an immutable design would make expensive later.
- Any future mutation endpoint must be **append-only**, enforced server-side.

Not scoped here, and the premium tier itself is undecided — this only avoids
painting it into a corner. Distinct from CLAUDE.md's open B2B monetization
question; that is business-to-business, this is consumer.
| RTL | App names come from the OS untranslated; rows must be RTL-safe per the i18n skill |

---

## 10. Store-review risks on both platforms

`QUERY_ALL_PACKAGES` is a restricted permission. It needs a Play Console
declaration, review takes weeks, and it can be refused — in which case the app
cannot ship with full enumeration.

The owner chose full enumeration for the Android host picker knowingly
(2026-08-07). It does not block development, only release, and the mitigation is
already built rather than hypothetical: the catalog (§6) ships regardless, because
iOS needs it. A refusal points the Android side of the §7 seam at that same
catalog — a one-line change, no UI rewrite, no lost functionality beyond niche
apps.

### iOS — `LSApplicationQueriesSchemes`

Declaring ~50 URL schemes to probe installed apps (§6) is a documented API, but
Apple has historically scrutinised large scheme lists because the same mechanism is
a known device-fingerprinting technique. Ours is a legitimate, user-visible use —
filtering a picker to apps you actually have — and should be described that way in
review notes rather than left to be inferred.

Lower risk than the Play declaration, and it degrades gracefully: strip the schemes
and the iOS picker simply shows the unfiltered catalog, which still works.

Both belong in `docs/DEPLOYMENT.md` and `docs/MANUAL_QA.md`.

---

## 11. Task breakdown

Seven backlog tasks, each closable with a green suite. Tests first
(`.claude/skills/testing-standards/SKILL.md`).

1. **Schema + server** — migration with backfill (sessions *and* venues), pgTAP for
   the constraints and grants, zod validation on create, the safety denylist, the
   venue subset check, preview fields.
2. **App catalog + source seam** — the bundled JSON (§6), package/name lookup,
   and the seam the picker reads through, with an integrity test (unique ids,
   valid categories, well-formed package names). Pure TS, fully testable here, and
   it unblocks the UI without waiting on native work. Includes the iOS
   `canOpenURL` installed-check behind the same seam (mocked in tests; the
   `LSApplicationQueriesSchemes` entries and real probing are manual QA).
3. **`InstalledAppsModule`** — Android native module behind that seam, windowed
   icon call, JS-side contract test over a mocked bridge.
4. **Create Session UI** — category toggles, app picker, validation, persisted
   default.
5. **Enforcement wiring** — packages through `start()`, service poll,
   `BootPersistence`, `SessionRow`/`SESSION_COLUMNS`, the widened
   `shield_triggered` shape, and overlay copy that names the blocked app.
6. **Join flow** — Screen 8 blocklist display, iOS re-selection in Apple's picker
   with header text, the blocklist-keyed selection cache, and the token-learning
   map (§7). Both platforms.
7. **In-session display** — Screen 6's expandable blocklist (§7), read-only, off
   the already-hydrated session row.

Tasks 1 and 2 are independent roots; 3 and 4 depend on 2, 5 on 1, 6 on 1 and 4,
7 on 1. Task 2 before 3 deliberately: the catalog makes the whole feature
demonstrable on iOS and on any Android build, before the Play-gated enumeration
exists.

---

## 12. What cannot be verified on this machine

Per `.claude/skills/platform-constraints/SKILL.md`:

- **All iOS behaviour.** No Mac; iOS compiles in cloud CI and has never run.
- **`canOpenURL` probing** — needs a real iPhone with real apps installed. The JS
  seam is testable here over a mocked bridge; whether each declared scheme
  actually resolves is not.
- **Icon performance** — emulator only, never a real device with ~200 apps.
- **The Play declaration outcome.**
- **Token rotation** — unobservable here; documented, not solved.

---

## 13. Docs this invalidates

- `docs/ARCHITECTURE.md` §4 — "fixed set of default categories… not a per-session
  or per-user app picker" and "No new `sessions` schema needed for this" both
  become false.
- `docs/DATABASE.md` — the `BLOCKED_APP_CATEGORIES` config row, plus the new
  columns in the schema section.
- `apps/mobile/src/config/blocked-categories.ts` — its header comment states the
  list is "not user- or session-configurable". It becomes the picker's *default*,
  not the enforced truth.
- `docs/ARCHITECTURE.md` §10 — venue blocklists join Verified Host as a
  manually-approved B2B flag (§3).
- `backlog.md` — the seven tasks above.
- `docs/MANUAL_QA.md`, `docs/DEPLOYMENT.md` — §10 and §12.

---

## 15. Still open

Every design question this plan raised has been decided (2026-08-07). What remains
is outside its scope:

- **B2B monetization**, unchanged from CLAUDE.md. §3's venue approval is an
  anti-abuse control, not a business model.
- **The consumer premium tier** that §9a keeps room for. Its existence is intended;
  its shape, pricing and whether blocklist editing is really the hook are not
  decided, and nothing here depends on the answer.

`backlog.md` has these seven tasks and per-task truth once work starts.

---

## 14. Sources

- [bundleIdentifier with FamilyControls .individual authorization](https://developer.apple.com/forums/thread/764988) — the Apple engineer answer quoted in §2
- [Getting bundleIdentifier from an ApplicationToken](https://developer.apple.com/forums/thread/782492)
- [ShieldSettings.ActivityCategoryPolicy](https://developer.apple.com/documentation/managedsettings/shieldsettings/activitycategorypolicy) and [.all(except:)](https://developer.apple.com/documentation/managedsettings/shieldsettings/activitycategorypolicy/all(except:))
- [Monitoring all categories without FamilyActivityPicker](https://developer.apple.com/forums/thread/725184) — category tokens cannot be constructed
- [Unblocking one app after ActivityCategoryPolicy.all()](https://developer.apple.com/forums/thread/732484)
- [The state of the Screen Time API](https://riedel.wtf/state-of-the-screen-time-api-2024/) — token instability
- [Screen Time API inconsistencies (iOS 26)](https://developer.apple.com/forums/thread/819997)
