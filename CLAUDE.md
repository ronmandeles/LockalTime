# Lockal Time

Social, location/time/group-based distraction-blocking app. Native iOS + Android via React Native, a Node.js/Express API for business logic, Supabase (Postgres/Auth/Realtime) for data/auth/realtime.

## Non-negotiables

1. **Money-equivalent logic is server-only.** Points, bonuses, QR tokens — anything affecting a user's earned rewards — are computed and minted **only** in the Node API. Never trusted from a client claim, never computed client-side even for display; always fetched from the server's authoritative value. Why: `docs/ARCHITECTURE.md` §3 and §8.
2. **TDD.** Every code task starts with the test file, agreed as correct, before any implementation.
3. **One task at a time, closed fully.** `backlog.md` order; suite green + docs updated before the next starts.
4. **Stop and ask** on any product/design decision not derivable from `docs/` or existing tests — always, without exception, for anything in *Open decisions* below.

`.claude/skills/` holds this repo's binding conventions. They apply to subagents too, and a convention that doesn't exist yet gets written as a new skill in the same turn as the code that needed it.

## Repo map

```
apps/server    Express + TypeScript API — the trust boundary. An npm workspace.
apps/mobile    React Native 0.86 (bare), TS strict, React Navigation + Zustand + XState.
               Deliberately NOT a workspace, so Metro/Gradle keep their own node_modules.
supabase/      Migrations + pgTAP tests. Local stack only; prod pushes are manual.
docs/          Architecture, schema, design, status, manual QA.
backlog.md     The phased WBS. Authoritative task state.
```

Commands: `npm test`, `npm run lint`, `npm run typecheck` in each workspace; `npm run test:integration` for real-stack tests; `supabase test db` for pgTAP. Full gate in `task-workflow`.

## Docs

| File | Contains |
|---|---|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Screens, stack, native blocking, realtime, session lifecycle & host authority, points/bonus engine, threat model |
| [docs/DATABASE.md](docs/DATABASE.md) | Full schema, bonus computation algorithm, config constants |
| [docs/DESIGN_GUIDELINES.md](docs/DESIGN_GUIDELINES.md) | Spacing/radius/typography/motion rules; **§12 is the current, authoritative color palette** |
| [backlog.md](backlog.md) | Per-task state — what's done and what's next |
| [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md) | Phase-level narrative: what shipped, what's inert, what's still open |
| [docs/MANUAL_QA.md](docs/MANUAL_QA.md) | Everything unverifiable on this machine, with steps to run it later |
| [docs/RETENTION_STRATEGY.md](docs/RETENTION_STRATEGY.md) | The retention analysis behind gamification work |
| [docs/BLOCKLIST_SELECTION_PLAN.md](docs/BLOCKLIST_SELECTION_PLAN.md) | Phase 9's design: the host picks what a session blocks, and why iOS constrains it |
| [docs/APP_CATALOG.md](docs/APP_CATALOG.md) | How the bundled app catalog was chosen, what in it is unverified, and how to refresh it |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Railway + staging-Supabase runbooks |
| [docs/NAVY_THEME_PLAN.md](docs/NAVY_THEME_PLAN.md) | Historical record of *why* the black+navy palette is what it is. For what the app looks like now, read DESIGN_GUIDELINES §12 instead |

## Current state

Phases 0–9 are complete; Phase 7 (Release Prep) has owner-actioned items still open. Details in [docs/PROJECT_STATUS.md](docs/PROJECT_STATUS.md); per-task truth in [backlog.md](backlog.md).

**Phase 9 (host-selected blocklist) shipped 2026-08-08** — the host now chooses what a session blocks, per session, from six categories plus specific apps ([docs/BLOCKLIST_SELECTION_PLAN.md](docs/BLOCKLIST_SELECTION_PLAN.md)). Its **entire iOS half is written and compiled but has never run**, which is more consequential than usual here: Apple's tokens can't be built from a bundle id or moved between devices, so iOS members re-select the blocklist in Apple's own picker at join, and the token-learning that avoids re-asking is unverifiable on this machine. See `docs/MANUAL_QA.md`.

The app first ran on an Android emulator on 2026-08-03. iOS compiles only in cloud macOS CI and has never been run. Push and attestation are fully wired but deliberately inert (no credentials).

## Decided — don't re-litigate

- Express (not NestJS). React Navigation + Zustand + XState. Maestro (not Detox) for E2E.
- App identifier `com.lockaltime.app` on both platforms.
- i18n from day one — English + Hebrew including RTL. **No hardcoded UI strings, ever.**
- Migrations are verified against local Supabase only; the owner pushes to production manually.
- Staging is a second free-tier Supabase project (`LockalTime-staging`). Migrations land there before prod. E2E and load tests target staging or local — **never production**.
- Auth order: email built and fully tested first; Google/Apple wired against placeholder config and marked manual-QA pending until real credentials exist.
- No Mac available — iOS is authored blind and verified by JS-side contract tests; it never blocks a phase.
- Verified Host is granted manually by flipping a DB flag in Supabase. No in-app application flow (V2, `docs/ARCHITECTURE.md` §10). **A venue's approved blocklist is granted the same way** (Phase 9) — a `static_qr` session seats up to 200 strangers, so the business's choice needs a ceiling the business can't set itself.
- **Both platforms offer the same fixed app catalog** (`docs/APP_CATALOG.md`), filtered per device to what the host actually has — iOS via `canOpenURL`, Android via the manifest's `<queries>` block. Android does **not** enumerate installed apps, and `QUERY_ALL_PACKAGES` must not come back: it is a restricted permission needing a Play Console declaration that can be refused (owner decision 2026-08-08, reversing 2026-08-07's full-enumeration choice; guarded by a test). An app outside the catalog can't be named by anyone — categories cover the long tail.
- The blocklist is **frozen for a session's lifetime** — not editable by the original host, nor by one promoted through host migration. That closes an exploit, not just a design question (`docs/ARCHITECTURE.md` §4). Kept as a server-side policy over a mutable column, so a future add-only editing path stays cheap.
- Branching: feature/phase branch off `main`, merged straight back to `main`. **No `dev` branch.**

## Product direction — engagement is a goal

The owner wants Lockal Time to be deliberately **engaging / high-retention** ("addictive"), on the theory that hooking users on *this* app reduces their overall phone use — so retention serves the mission and is a selling point.

This **reverses** the restrained anti-engagement philosophy still written in `docs/ARCHITECTURE.md` §1 and §9 (both flagged "under revision"). When building anything gamification-, notification-, or engagement-related: design *for* retention, don't invoke the old "avoid variable rewards / no comparison" rules as binding, and surface where a known addictive pattern could fit — folding it into the plan step. **But no specific mechanic is decided**, so still stop and ask before committing to one.

## Open decisions — never invent an answer here

- B2B monetization, and a real Verified Host application flow (manual-flag approach stays for now — V2).
- Concrete product-roadmap milestones: beta and launch dates. A scheduling call, not an engineering task.
- Phase 8 follow-ups: the launcher icon is still teal, and the onboarding copy dropped in the restyle is now explained nowhere.
