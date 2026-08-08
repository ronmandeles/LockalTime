# The bundled app catalog

The data file is [`apps/mobile/src/config/app-catalog.json`](../apps/mobile/src/config/app-catalog.json).
This file explains how it was chosen, what in it is verified and what isn't, and
how to refresh it. Produced by Phase 9 task 2 (2026-08-07) as a deliberately
separate research task, so the list got real attention instead of being
improvised inside a coding task — and so it can be refreshed later without
touching a line of code.

Why the catalog exists at all is [`BLOCKLIST_SELECTION_PLAN.md`](BLOCKLIST_SELECTION_PLAN.md) §6.
The short version: it is **the only way an iOS host can name a specific app**,
because Apple's picker hands back opaque tokens that mean nothing on anyone
else's phone.

## What's in it

87 entries.

| Category | Entries |
|---|---|
| `social` | 33 |
| `entertainment` | 18 |
| `games` | 16 |
| `productivity` | 9 |
| `news` | 7 |
| `maps` | 4 |

## The selection rule

**The catalog is deliberately partial, and completeness is not the goal.** Most
games and most streaming apps will never be in it. They don't need to be —
categories handle the long tail. Every game on the device is covered by `games`
whether or not we have heard of it.

What categories *can't* do is the case where someone wants Instagram blocked and
WhatsApp left alone. That is why the list is weighted heavily toward **social**
(38% of it): social is where "block the whole category" is too blunt, and where
people actually name a specific app. Games and entertainment carry only the
handful people genuinely single out.

A missing entry degrades to "use the category instead", which is a real answer
rather than a dead end.

Two exclusions worth stating, since both look like omissions:

- **No browsers, shopping, banking or messaging-only utilities.** None map to one
  of the six categories, and the ones that do get close (a bank's app under
  `productivity`) are the sort of thing the plan's "nobody is ever trapped" note
  covers by exit, not by curation.
- **Nothing on the safety denylist.** The dialer, SMS and Settings apps and our
  own package are refused server-side (`apps/server/src/modules/sessions/blocklist.ts`);
  they must never appear here either.

Ordering inside the file is by expected blocking frequency within each category,
not alphabetical. The picker sorts for display; the file's order is the record of
that judgement.

## `iosScheme` and the 50-entry budget

40 of the 87 entries carry an `iosScheme`. Those 40 strings are exactly what goes
into `Info.plist`'s `LSApplicationQueriesSchemes`, and **Apple caps that array at
50** — so there are 10 spare slots, deliberately. It is twenty questions, not a
directory listing.

The scheme exists only to filter the iOS picker down to apps the host actually
has, so it reads as "your apps" rather than "popular apps". Entries without one
are shown unfiltered, which is harmless: blocking an app the host doesn't own is
a no-op on their device and still blocks correctly for members who do.

**A wrong scheme is worse than a missing one.** A declared scheme that doesn't
resolve makes `canOpenURL` return false, and the entry is then hidden from a host
who *does* have the app. So a scheme was included only where it is
well-documented and stable; every entry below the confidence bar was left without
one on purpose, not overlooked.

One that would have been wrong from memory and wasn't: TikTok's scheme is
**`snssdk1233`**, not `tiktok` (`tiktoksharesdk` is the share SDK's, a different
thing).

## What is NOT verified here

Per [`.claude/skills/platform-constraints/SKILL.md`](../.claude/skills/platform-constraints/SKILL.md),
this machine can check the *shape* of every row and nothing about its truth. The
integrity test (Phase 9 task 3) asserts unique ids, valid categories, well-formed
package names, unique schemes, and the ≤50 count. It cannot assert that
`com.wbd.stream` is really HBO Max.

Both of the following are in [`MANUAL_QA.md`](MANUAL_QA.md):

- **Every package name against a real Play Store listing.** A wrong one fails
  silently — it blocks nothing, forever, with no error anywhere.
- **Every declared scheme against a real iPhone** with that app installed.

Known ambiguity already found: **HBO Max ships two live Play listings**,
`com.wbd.stream` and `com.wbd.hbomax`. The catalog carries `com.wbd.stream`; if
the other turns out to be the current one, this is a one-line data change.

## Refreshing it

It is one JSON file with no code in it — edit and ship. The integrity test will
catch a malformed row. When adding entries:

1. Confirm the package name on the app's real Play Store listing.
2. Add an `iosScheme` only if you can point at documentation for it, and only
   while the total stays ≤ 50.
3. Prefer social. See the selection rule above.
4. Nothing on the safety denylist.

Whether the list is *right* is guesswork by construction until there are real
users — aggregate data on what people actually block is the only signal that
would settle it, and that is deliberately not collected
(`BLOCKLIST_SELECTION_PLAN.md` §15, owner decision: revisit once there are users
to learn from).
