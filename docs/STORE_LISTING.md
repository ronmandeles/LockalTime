# Store Listing Content (Phase 7 — Release Prep)

Draft content for App Store Connect / Google Play Console, for owner review
— not yet submitted anywhere (needs the owner's Apple Developer/Play
Console sessions, which this environment has no access to). Screenshots
are NOT included here: they need a real running build on a real or
simulated device, which is itself gated on the manual-QA items in
`docs/MANUAL_QA.md`.

## App name & tagline

- **Name:** Lockal Time
- **Subtitle / short description (Apple, ≤30 chars):** Focus together, block distractions
- **Short description (Google, ≤80 chars):** Block distracting apps together with friends, in real sessions.

## Full description (draft)

Lockal Time helps you actually put your phone down — with people, not alone.

Start a session (solo, or with friends via a QR code, or at a participating
venue) and Lockal Time blocks the distracting apps you'd otherwise reach
for, for as long as the session runs. Earn points for real focused time,
build a streak, and see how your friends are doing too.

- **Real device-level blocking** — not just a timer or a to-do list.
  Distracting apps are actually blocked while your session runs.
- **Group sessions** — start a session with friends nearby (scan a QR code)
  or solo, wherever you are.
- **Points, streaks, and milestones** — see your progress build over time.
- **Friends & leaderboard** — see how your friends are doing, compared to
  you (never their exact history — just the headline numbers).
- **Venues** — some cafes and study spaces host their own sessions; join
  one when you're there.

No ads, no in-app purchases in this version. Full data practices: see our
Privacy Policy (linked in-app, Settings → Privacy Policy).

## Keywords (Apple, comma-separated, ≤100 chars total)

focus,productivity,screen time,distraction,phone addiction,study,block apps,accountability

## Category

- **Apple:** Productivity (secondary: Health & Fitness)
- **Google Play:** Productivity (secondary: Health & Fitness)

## Age rating

No user-generated content beyond a display name/username/avatar URL and a
friend graph — no photo/video sharing, no public posts, no chat/messaging
between users. Recommend the lowest applicable tier on both stores:
- **Apple:** 4+
- **Google Play:** Everyone

Owner should double-check this against each store's current questionnaire
at submission time — ratings questionnaires change over time and this is a
recommendation, not a final answer.

## Support URL / contact

`[SUPPORT CONTACT EMAIL / URL — fill in before publishing]` (same
placeholder as `legal-content.ts`'s ToS/Privacy contact — pick one real
channel and use it consistently across both).

## Privacy Nutrition Label (Apple) / Data Safety form (Google)

Backed by the real data-footprint audit in
`apps/server/src/modules/legal/legal-content.ts`'s Privacy Policy. Answers
below map to each store's own categories — exact form field names differ
slightly between the two, but the underlying facts are identical.

| Data type | Collected? | Linked to identity? | Used for | Shared with third parties? |
|---|---|---|---|---|
| Email address | Yes | Yes | Account creation/auth | No (only our auth provider, Supabase, as a processor) |
| Name (display name/username) | Yes | Yes | Identifying you to friends | No |
| User ID | Yes | Yes | Account functionality | No |
| Photos (avatar URL only, not files) | Optional | Yes | Profile display | No |
| Precise location | **No** | — | — | — |
| Coarse location | **No** | — | — | — |
| Contacts | **No** | — | — | — |
| Usage data (sessions, points, streaks) | Yes | Yes | Core app functionality, gamification | No |
| Device identifiers (push token) | Yes, optional | Yes | Push notifications | No (only our push provider, once real FCM/APNs credentials exist) |
| Device/attestation data (Play Integrity/App Attest verdict + raw response) | Yes | Yes | Anti-cheat / fraud prevention (never shown to other users) | No |
| Crash/error logs | Yes (once Sentry is activated) | Pseudonymous | App stability | No (only our crash-reporting provider, once activated) |
| Financial info | **No** | — | — | — |
| Health/fitness data | **No** | — | — | — |
| Contacts/social graph beyond in-app friends | **No** (only usernames of users you explicitly friend within the app) | — | — | — |

**Data retention:** account data is retained for the life of the account;
deleting your account (Settings → Delete account, in-app) permanently
removes it — enforced by database cascading deletion (see `docs/DATABASE.md`'s
account-deletion migration), not a manual process.

**Tracking:** none — Lockal Time does not track users across other
companies' apps/websites for advertising purposes, and has no ad SDK.

## Pre-submission checklist (do not submit until every box is checked)

- [ ] Replace every `[PLACEHOLDER]` in `legal-content.ts` and this document
  with real values (legal entity name, contact email, effective date,
  governing law/jurisdiction).
- [ ] Real screenshots captured from a real build (see `docs/MANUAL_QA.md`'s
  device-availability items).
- [ ] Real app icon in place (see `docs/DESIGN_GUIDELINES.md`'s icon section).
- [ ] Support URL/contact is a real, monitored channel.
- [ ] Age rating questionnaire completed directly on each store (the table
  above is a recommendation to speed that up, not a substitute for it).
