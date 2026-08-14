---
name: testing-standards
description: TDD protocol, test types, coverage bar, and determinism rules. Read before any coding task and before writing any test.
---

Read before any coding task. TDD is a hard rule in this project (`CLAUDE.md` working contract): the test file exists and is agreed correct **before** implementation code is written.

## TDD protocol
1. Write the `.test.ts` / `.spec.tsx` first, expressing the intended behavior as concrete cases.
2. Confirm the test is right (and failing for the right reason — the thing under test doesn't exist yet).
3. Write the minimum implementation to make it pass.
4. Refactor with the test as a safety net.
Never write implementation before a failing test exists for it.

## Test types & where they apply
- **Unit tests (Jest)** — all pure logic, especially money-equivalent math: base points, group bonus, completion bonus, additive stacking, proration, streak boundaries. This is the highest-value test surface in the app. Use table-driven cases covering: base case, each bonus in isolation, both bonuses stacked, emergency-exit forfeiture, boundary values (exactly 30 min, exactly 5 participants, 47h vs 49h streak gap per Phase 5 DoD).
- **Component tests (React Native Testing Library)** — UI with real state transitions, chiefly the Timer/countdown: render with **fake timers** and mocked realtime events, assert visual state transitions (e.g. green→amber→red) without real `setInterval` delays. Test behavior/accessibility, not implementation details or snapshot noise.
- **Integration tests** — API endpoints against a local Supabase (`supabase start`): create → join → complete produces correct `rewards_history`; RLS owner-vs-non-owner assertions.
- **E2E (Maestro)** — golden paths across real navigation: create → second device joins via QR → complete; and create → emergency exit → verify reduced points. Run against local/staging Supabase, never production.

## Coverage bar
- **Points/bonus module (`apps/server/.../points/`): 90%+**, non-negotiable — it's the money-equivalent core.
- Other logic modules: 85%+.
- Coverage is a floor, not the goal. A green 90% with weak assertions is worse than honest 85% with strong ones. Assert on outcomes and edge cases, not line execution.

## Native modules
- FamilyControls / UsageStats / foreground-service code can't be unit-tested in JS. For these:
  - Write a **JS-side contract test** that mocks the native bridge and asserts `useAppBlocker` reacts correctly to each event (`shield_triggered`, `service_killed`, `permission_revoked`, `battery_critical`).
  - Cover the actual native behavior with a **documented manual QA checklist** in `docs/` (physical-device: block real app, kill app, reboot, revoke permission mid-session).

## Determinism & hygiene
- No test depends on wall-clock time, real network, or another test's ordering. Inject clocks; server issues authoritative timestamps (`ARCHITECTURE.md` §8 item 5) — tests pass them explicitly.
- **`testTimeout` and RNTL's `asyncUtilTimeout` are two separate budgets.** jest's `testTimeout` bounds the whole test; `waitFor`/`findBy*` enforce their own, defaulting to **1000ms**, which `testTimeout` never touches. Raising one does nothing for the other — this repo shipped a `testTimeout: 20000` fix for the cold-cache transform cost and went on failing for months on the 1s budget sitting underneath every `await waitFor(...)`. Both are now set centrally in `apps/mobile/jest.setup.js`. Never tune a per-call `waitFor` timeout to paper over a harness-wide problem; if one call site needs more, the harness needs more.
- **Warm shared module graphs in `jest.setup.js` — never with a render.** React Native's `index.js` exposes components through lazy getters, so the first `render()` in a spec pays their babel transform *inside* a timed wait. Touching those getters at setup pays it outside. Two things that look like better warm-ups and are not, both measured: a throwaway `render()` corrupts RNTL's global root tracking even when cleaned up (`toBeOnTheScreen()` then fails for elements that demonstrably are on screen, breaking the first test of five screen specs), and requiring app modules drags in native TurboModules that specs mock — `require('./src/i18n/init-i18n')` killed all 70 suites via `RNLocalize`. Only dependency-free module graphs can be warmed from a setup file.
- One behavior per test; the name states the expected behavior ("returns reduced points on emergency exit"), not the method name.
- A task with failing or skipped tests is not done. No `.skip` left in committed code without an inline reason and a backlog reference.
