# Lockal Time — Retention Strategy Analysis

Status: living analysis, first written Phase 5 task 1. Produced in response to the owner's 2026-07 product-direction pivot (see `CLAUDE.md` "Product direction" note): Lockal Time should be deliberately engaging/high-retention, on the theory that hooking a user on *this* app's focus-session concept reduces their overall phone use — retention serves the mission here, it isn't opposed to it.

**How to read this doc:** for each well-known consumer-app retention pattern, what it is, why it works, and a verdict — **Adopt now**, **Defer** (good fit, but blocked on missing infrastructure or needs its own design pass), or **Reject** (bad fit even under the pivot). This is the resolution of `ARCHITECTURE.md` §1/§9's "under active revision" banners — those sections now point here instead of carrying the analysis inline.

## Framing: what makes this different from a normal engagement pass

Most retention playbooks are written for apps that want more *time in app*. Lockal Time's mission is the opposite: more time in a focus *session*, which is time the user is explicitly not looking at their phone. So the question for every pattern below isn't "does this increase engagement" (almost all of them do, that's why they're famous) — it's "does the engagement it creates point at *starting sessions*, or does it create a reason to open the app and linger, which would fight the in-session design goal `DESIGN_GUIDELINES.md` §0 already protects." A pattern that makes someone check the app three times a day to start a 25-minute session is a win. A pattern that makes someone scroll a feed inside Lockal Time for ten minutes is the exact failure mode this product exists to prevent elsewhere.

## Patterns

### 1. Streaks & loss aversion — **Adopt** (already spec'd, Phase 5 tasks 2–5)
The single most durable retention mechanic in consumer software (Duolingo, Snapchat). Works via loss aversion: losing a 40-day streak hurts more than gaining day 41 helps. Fits cleanly here — a streak's entire ask is "start a session today," which is exactly the target action. Locked design (this session): a 48h rolling grace window (not a calendar-day streak), and **any session with real presence** keeps it alive regardless of `exit_reason` — deliberately the most forgiving version, since a punitive streak ("your dropped call cost you your streak") creates exactly the anxiety `ARCHITECTURE.md` §9 originally wanted to avoid, and that anxiety is *itself* a bad retention trade — it produces rage-quits, not habits. See DATABASE.md's `user_streaks` / Phase 5 tasks 5.2–5.3 for the implementation.

### 2. Goal gradient effect (progress bars, "X more to go") — **Adopt now** (Phase 5 task 7)
Motivation rises measurably as a goal nears (the classic finding: people wash cars faster to fill the last few stamps on a loyalty card). Milestones already existed in the pre-pivot spec (`ARCHITECTURE.md` §9's "Keep" list) but only as an after-the-fact announcement. The gradient effect requires **visible progress toward the next one**, not just a celebration once it's crossed. This is the one concrete mechanic Phase 5 adds beyond what was already planned: a progress bar on Home reading "3 more sessions to Milestone" (`milestones`/`user_milestones`, session-count-based, same "any session with presence" counting rule as streaks so the two ladders never disagree — see Phase 5 task 3). Low cost (pure display over data already being written), no new infrastructure, and the target behavior is still "start a session."

### 3. Variable/randomized reward schedules — **Reject**
The mechanism behind slot machines and loot boxes: unpredictable reward timing/size creates the strongest known compulsion loop, stronger than fixed rewards. This is the sharpest possible reversal of `ARCHITECTURE.md` §9's original "never reward randomness" stance, so it gets real scrutiny rather than a reflexive pass. It fails the framing test directly: variable rewards train someone to keep *checking* — the compulsion is in the checking, not in the target behavior — which is the in-app-lingering failure mode, not the start-a-session win. It's also the one pattern with a real ethical line (loot-box-style mechanics draw regulatory attention in several markets) and would require touching money-equivalent code (a randomized bonus at Screen 10 is still money-equivalent, so it would need the same server-only, never-client-computed treatment as every other point). Verdict stands even under the pivot: reject, not deferred — this isn't "good fit, blocked on infra," it's a bad fit for what the product is trying to make habitual.

### 4. Social proof / leaderboards / comparison — **Defer**
Comparison against others is a strong driver (visible leaderboards, "5 friends completed a session today"). No technical blocker in principle, but a real one in practice: there is no friend graph, no follow/friend model, and no privacy design for surfacing one user's activity to another — building it well is its own phase of work, not a Phase 5 add-on. `ARCHITECTURE.md` §9 originally rejected this on anti-comparison-anxiety grounds; the pivot reopens it, but the honest reason it doesn't ship now is scope, not renewed rejection. A backlog entry is added (see below) so it's designed deliberately later rather than bolted on.

### 5. Notification hooks (streak-at-risk, "come back", session invites) — **Adopted (streak-at-risk), Phase 5.5**
Arguably the single highest-leverage retention lever available (a well-timed "your streak expires soon" push is a direct, proven habit-reinforcer) — and the one most examined for whether it fights the mission: a *streak-at-risk* notification still points at "go start a session," so it passes the framing test cleanly, unlike a generic "come back and look at the app" ping. Implemented Phase 5.5: `public.claim_streak_risk_notifications()` fires when `streak_grace_expires_at` is within `STREAK_RISK_NOTIFICATION_WINDOW_HOURS` (6, owner decision), dispatched through a `NotificationSender` seam. Ships as a fully-wired, tested, **inert** pipeline — no Firebase project or Apple Push credentials exist yet, same posture as Play Integrity/App Attest — so the claim logic and dispatch composition are real and proven end-to-end today, only actual delivery is a stand-in. Session invites and a generic "come back" ping remain out of scope (never proposed here — a session invite implies the social/friend-graph work in #4, still deferred).

### 6. Endowed progress (starting a meter partway full) — **Reject for now, revisit with #2**
A documented variant of the goal-gradient effect: people persist more toward a goal if they're told they're already partway there (vs. an equivalent goal starting at zero) — e.g., a 10-session milestone framed as "you're already 2/10" the moment someone signs up, rather than a plain 0/10 counter. This is a real technique, but applying it *honestly* here means literally crediting a new user with progress they haven't earned, which conflicts with the Money-Equivalent Logic Rule's spirit even though milestones aren't money — a "free" head start reads as manipulative once the user or a case-study writer notices the counter didn't start at zero. The milestone progress bar in #2 already gets the same visible-gradient benefit honestly (a real, growing number), so this is rejected rather than deferred — it isn't blocked on anything, it's just not worth doing dishonestly.

### 7. Level / XP ladders — **Reject for now**
A long-horizon progression system (derived from lifetime points, a widening curve) gives users who've cleared every milestone something still climbing. Reasonable pattern in the abstract, but it duplicates what the milestone ladder + streak already do here (both are already open-ended progress signals), and adding a third parallel number risks exactly the "badge overload" `ARCHITECTURE.md` §9 already named as a failure mode pre-pivot — that specific critique survives the pivot on its own merits (more numbers isn't more retention past a point, it's clutter). Not adopted; revisit only if user feedback post-launch shows engagement actually drops once someone has crossed every milestone.

## Adopted set (what actually ships in Phase 5)

- Streaks, 48h rolling grace, forgiving (any-presence) counting rule.
- Milestones, 6-tier session-count ladder, same forgiving counting rule.
- Milestone progress bar on Home (the goal-gradient addition).
- Transparent point receipts, unchanged from the pre-pivot spec (bonuses always broken out separately — this was never in tension with the pivot, it's a trust property, not a restraint one).

## Explicitly rejected

Variable/randomized rewards, dishonest endowed-progress framing, a parallel level/XP ladder.

## Deferred (designed, not started — see `backlog.md`)

- Social graph + comparison surfaces (friend model, privacy design, then leaderboard/social-proof UI) — `backlog.md`'s Phase 6.5.

## Closed

- Push notification infrastructure (`device_tokens`, a send-service seam, streak-at-risk as the first real notification) — Phase 5.5, see `backlog.md` and `docs/ARCHITECTURE.md` §9.
