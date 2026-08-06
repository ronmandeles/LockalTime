---
name: task-workflow
description: How a task is picked, closed, branched, and committed in this repo — the definition-of-done gate, verification commands, docs close-out, and branching rules. Read when starting or closing any backlog task.
---

One atomic task at a time, in `backlog.md` order. A task is not "done" until every gate below passes.

## Task loop

1. Pick the next unchecked `backlog.md` task, in order.
2. Plan → get agreement. No code before that.
3. Write the failing test first.
4. Implement.
5. Run the full verification gate (below).
6. Close out docs (below).
7. Teach the implementation, then move on.

Never bundle two tasks past a checkpoint.

## Verification gate

Run in the workspace(s) touched — all must be green before close-out:

```bash
npm test                 # apps/server and/or apps/mobile
npm run lint
npm run typecheck
npm run test:integration # if the task touched a real integration seam
supabase test db         # if the task touched the database
```

`apps/server` is an npm workspace (root `workspaces` is `["apps/server"]`). **`apps/mobile` is deliberately excluded** so Metro and Gradle keep their own `node_modules` — run its scripts from inside `apps/mobile`.

Report real results. "Tests pass" is a claim about output you have actually seen.

## Documentation close-out

Same turn as the code, not later:

- `backlog.md` — check the task `[x]` and append a one-line summary of what actually landed, including anything discovered mid-task and anything left manual-QA pending.
- Any `.md` whose claims changed: `docs/ARCHITECTURE.md` (new service/flow), `docs/DATABASE.md` (schema change), `docs/DESIGN_GUIDELINES.md` (visual system change), `docs/MANUAL_QA.md` (anything not verifiable on this machine), `docs/PROJECT_STATUS.md` (phase-level state).
- If a needed convention doesn't exist yet, add `.claude/skills/<name>/SKILL.md` (with `name`/`description` frontmatter) **alongside** the code, not after.

## Stop and ask

Stop when a task turns on a product or design decision that isn't derivable from `docs/` or existing tests. Anything touching a known gap or one of `CLAUDE.md`'s open decisions **always** stops and asks. Never invent a decision there.

## Branching

- Every feature and every phase gets its own branch **off `main`** (e.g. `phase5-gamification-stats`), merged **straight back into `main`** when it closes (suite green + docs updated).
- **There is no `dev` branch** (removed 2026-08-04). It added a second merge step and a second place for work to sit unmerged — in a solo workflow that bought nothing and hid planning/handoff artifacts from any session that checked out the default branch.
- Solo-dev: no PR review step, but still a real branch + merge rather than committing straight to `main`.
- Consequence: `main` is the working trunk, not "the last completed phase". Anything a future session must find — plans, handoff notes, docs — has to reach `main` to be discoverable.

## Commits

- **Only when explicitly asked.** Self-pacing through tasks does not imply auto-committing.
- Exception: an explicitly requested unattended/background autonomous run commits **and pushes to `origin`** after each task closes (suite green + docs updated), so there's a checkpoint to recover from if something later in the run goes wrong.
