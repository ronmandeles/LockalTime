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
| Solo session, either platform | **Exact.** The host is the only participant; they pick on their own device |
| Group session, host's own device | **Exact.** Their tokens are local |
| Group session, Android member | **Exact.** Package names and categories resolve locally |
| Group session, iOS member | **Exact, but manual** — they re-pick in Apple's picker at join |

The iOS member flow is the owner's design (2026-08-07): Session Details (Screen 8)
describes the session's blocklist before joining, and tapping Join presents
Apple's picker so the member selects those apps on their own device. Their phone,
their tokens.

### An asymmetry that constrains the UI

An **iOS host cannot share a specific-app selection**. They can pick apps in
Apple's picker and block them on their own phone, but they receive opaque tokens
and have nothing to write into `blocked_packages` — so nothing reaches other
members. Package names are an Android concept, and we are using them as the
cross-device app identity.

Consequence: **specific-app selection is offered to Android hosts only.** An iOS
host shares categories; their own device can additionally shield whatever they
picked personally. This must be explicit in the UI, not a silent no-op.

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

**Future kind:** iOS also supports `webDomainTokens`. If website blocking is ever
wanted, it's a third column, not a remodel.

---

## 4. Server

| Endpoint | Change |
|---|---|
| `POST /sessions` | accepts `blocked_categories`, `blocked_packages` |
| `POST /sessions/preview` | returns both, so Screen 8 can describe the session pre-join |

Zod at the boundary (`.claude/skills/api-design/SKILL.md`): categories from the
enum, packages against a package-name pattern, combined length ≥ 1, capped at 3
categories and 50 packages to bound the payload.

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

## 6. Only package names cross between users

It would be easy to send `{ id, label }` so members see "Instagram" rather than
`com.instagram.android`. **Don't.** That is host-controlled text rendered on
strangers' phones — a venue session seats up to 200 people
(`VENUE_SESSION_MAX_PARTICIPANTS`) — and a verified host could put anything in it.

So: package names only. Each Android device resolves its own display label
locally, from its own `PackageManager`. iOS members see the raw package name,
which is legible enough (`com.instagram.android`), and Apple's picker shows real
names one tap later anyway.

*Reviewed and cut:* an earlier draft shipped a bundled `package → display name`
catalog for prettier iOS rendering. It was maintenance burden (apps rebrand),
guaranteed incomplete, and bought only cosmetics on a screen whose next tap shows
the real names. Add later if it genuinely annoys anyone.

---

## 7. Mobile UI

### Create Session (Screen 5)

New section below session type:

- Three category toggles, reusing the existing toggle styles on that screen.
- **Android only:** an expandable installed-app list with checkboxes.
- Pre-filled from the user's last choice, editable per session (persisted
  client-side, following `active-session-store.ts`'s pattern).
- Submit blocked with a message if nothing at all is selected.

**Make the app list source-agnostic from day one.** The picker component takes a
list; where that list comes from is behind a seam. If Google refuses
`QUERY_ALL_PACKAGES` (§10), falling back to a curated catalog becomes a data-source
swap instead of a UI rewrite.

### Session Details (Screen 8)

Already the participant's pre-join confirmation and already fetching a preview.
Add "This session blocks: Social, Games, com.instagram.android". On iOS, Join then
presents Apple's picker; on Android, Join proceeds directly.

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
| Blocklist edited mid-session | Entry point disabled while a session is active. The saved *default* is client-side and the running session reads from the server, so editing the default can't leak into a live session |
| Reboot mid-session | Covered once `BootPersistence` carries packages |
| Host migration / rejoin | Session-scoped, survives both unchanged |
| Pre-existing sessions | Column default reproduces today's behaviour |
| iOS host picks specific apps | Applies to their own device only; UI must say so (§2) |
| RTL | App names come from the OS untranslated; rows must be RTL-safe per the i18n skill |

---

## 10. The Play review is the schedule risk

`QUERY_ALL_PACKAGES` is a restricted permission. It needs a Play Console
declaration, review takes weeks, and it can be refused — in which case the app
cannot ship with full enumeration.

The owner chose full enumeration over a curated catalog knowingly (2026-08-07).
It does not block development, only release. The §7 source seam is the mitigation:
a refusal degrades to a curated catalog without touching the UI.

Belongs in `docs/DEPLOYMENT.md` and `docs/MANUAL_QA.md`.

---

## 11. Task breakdown

Five backlog tasks, each closable with a green suite. Tests first
(`.claude/skills/testing-standards/SKILL.md`).

1. **Schema + server** — migration with backfill, pgTAP for the constraints and
   grants, zod validation on create, preview fields.
2. **`InstalledAppsModule`** — native module, windowed icon call, JS seam with a
   mocked-bridge contract test.
3. **Create Session UI** — category toggles, app picker behind the source seam,
   validation, persisted default.
4. **Enforcement wiring** — packages through `start()`, service poll,
   `BootPersistence`, `SessionRow`/`SESSION_COLUMNS`.
5. **Join flow** — Screen 8 blocklist display, iOS picker-at-join, both platforms.

Tasks 1 and 2 are independent roots; 3 depends on 2, 4 on 1, 5 on 1 and 3.

---

## 12. What cannot be verified on this machine

Per `.claude/skills/platform-constraints/SKILL.md`:

- **All iOS behaviour.** No Mac; iOS compiles in cloud CI and has never run.
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
- `backlog.md` — the five tasks above.
- `docs/MANUAL_QA.md`, `docs/DEPLOYMENT.md` — §10 and §12.

---

## 14. Sources

- [bundleIdentifier with FamilyControls .individual authorization](https://developer.apple.com/forums/thread/764988) — the Apple engineer answer quoted in §2
- [Getting bundleIdentifier from an ApplicationToken](https://developer.apple.com/forums/thread/782492)
- [ShieldSettings.ActivityCategoryPolicy](https://developer.apple.com/documentation/managedsettings/shieldsettings/activitycategorypolicy) and [.all(except:)](https://developer.apple.com/documentation/managedsettings/shieldsettings/activitycategorypolicy/all(except:))
- [Monitoring all categories without FamilyActivityPicker](https://developer.apple.com/forums/thread/725184) — category tokens cannot be constructed
- [Unblocking one app after ActivityCategoryPolicy.all()](https://developer.apple.com/forums/thread/732484)
- [The state of the Screen Time API](https://riedel.wtf/state-of-the-screen-time-api-2024/) — token instability
- [Screen Time API inconsistencies (iOS 26)](https://developer.apple.com/forums/thread/819997)
