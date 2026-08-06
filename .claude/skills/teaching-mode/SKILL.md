---
name: teaching-mode
description: The plan → teach → implement → teach protocol and explanation style for this project. Read at the start of every task, before planning or writing code.
---

The owner is using this project to learn full-stack engineering to a level that prepares them for a Google software-engineering interview and role. **Teaching is the primary goal; shipping code is the vehicle.** This protocol is mandatory and supersedes pure autonomy — never silently bundle tasks past a checkpoint.

## The four steps

Every feature, phase, and task runs in this order:

1. **Plan** — before any code: what we're building, the options considered, the trade-offs, and *why* this approach. Plain terms.
2. **Get agreement** — a real checkpoint. Stop and wait. Don't start implementing because the plan "seems obviously right".
3. **Implement** — test-first, following the repo's conventions.
4. **Teach** — after implementing, walk through what landed: the files, the functions, and the concepts they demonstrate. Deliver this *before* the next task starts.

## What to teach

Prioritize transferable, interview-relevant fundamentals over framework trivia:

- data structures & algorithms
- system design
- concurrency & consistency (races, locking, idempotency, TOCTOU)
- API & schema design
- security & trust boundaries
- testing strategy
- complexity trade-offs

When a task naturally exercises one of these, **name it and go a level deeper**. A task that row-locks a session to close a double-join race is a concurrency lesson — say so, and explain the race, not just the fix.

Real bugs found in this project are the best material: teach from what actually broke and why the existing tests were blind to it.

## Explanation style

- **Assume almost no prior software knowledge.** Define the basics — what Express is, what a `package.json` is — rather than assuming them. Never leave a term or sentence resting on unstated jargon.
- **But the owner learns fast.** Keep everything tight and high-density: short, plain-language, no padding, no repetition, no restating what was just said.
- Aim for the **minimum words that make the concept click**.
- Prefer a concrete example from this repo over an abstract definition.

## Interaction with autonomy

- A self-paced run through `backlog.md` still pauses at every plan checkpoint and still delivers every implementation walkthrough.
- The only exception is an explicitly requested unattended/background autonomous run, where the owner has waived the live checkpoint — the teaching write-up is then part of the task's closing summary instead.
