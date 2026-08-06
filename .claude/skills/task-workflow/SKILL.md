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

## Git: run it to completion, don't ask per step

**Standing authorization (owner decision, 2026-08-06 — supersedes the earlier "commit only when explicitly asked" rule).** Finishing a task means finishing its git flow. Do all of it in one go, without asking permission at each step:

```bash
git checkout -b <type>/<slug>     # off main: phase8-…, docs/…, fix/…
git add <the files you changed>   # never `git add -A`
git commit                        # real message, see below
git checkout main
git merge --no-ff <branch>
git push origin main
git branch -d <branch>            # local cleanup
```

**End state to verify and report: `git status` says "working tree clean", `main` is not ahead of `origin/main`, and no stale local branch is left behind.** Run `git status --short --branch` and `git branch` as the last step and report what they actually said. "Clean working tree" and "everything pushed" are different claims — check both.

Asking "shall I commit?", "shall I merge?", "shall I push?" as three separate turns is the thing this rule exists to stop.

### Still stop and ask for

- **Deleting remote branches** (`git push origin --delete`) and any history rewrite: `push --force`, `reset --hard`, `rebase` onto shared history. These can destroy work that exists nowhere else.
- Anything where a branch holds commits **not** reachable from `main` (`git rev-list --count main..<branch>` > 0). Verify before deleting anything.

### Commit messages

Explain **why**, not just what. A message that only restates the diff is wasted — the diff is already there. Reference what broke, what was measured, or what decision drove the change. End with:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Branching

- Every feature and every phase gets its own branch **off `main`** (e.g. `phase5-gamification-stats`), merged **straight back into `main`** when it closes (suite green + docs updated).
- **There is no `dev` branch** (removed 2026-08-04). It added a second merge step and a second place for work to sit unmerged — in a solo workflow that bought nothing and hid planning/handoff artifacts from any session that checked out the default branch.
- Solo-dev: no PR review step, but still a real branch + merge rather than committing straight to `main`.
- Merged branches get deleted, local and remote. A branch list that accumulates every finished phase is noise — `main` already contains all of it.
- Consequence: `main` is the working trunk, not "the last completed phase". Anything a future session must find — plans, handoff notes, docs — has to reach `main` to be discoverable.
