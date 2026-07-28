# Realtime Load Test (Phase 7 — Release Prep)

`realtime-load-test.js` drives real `@supabase/supabase-js` Realtime clients
(the same library `apps/mobile`'s `session-channel.ts` uses) to load-test
Presence + Broadcast fan-out capacity — see the script's own header comment
for why Postgres Changes (the one *trusted* realtime primitive) is out of
scope for this specific test.

```sh
node loadtest/realtime-load-test.js
# or override the shape:
NUM_SESSIONS=10 PARTICIPANTS_PER_SESSION=50 node loadtest/realtime-load-test.js
```

Never point this at production — same rule as every E2E/load test in this
repo (`CLAUDE.md`); the script itself refuses to run against a `*.supabase.co`
URL that doesn't look like staging.

## Real result against the local stack (this phase)

Run at the target scale (10 sessions × 50 = 500 concurrent connections):
**50% connection failure rate.** Diagnosed down to the actual cause (not a
bug in this script):

- At **100 concurrent connections**: 100% success, p50 subscribe latency
  ~280ms, p50 broadcast delivery ~10-20ms — healthy.
- At **300 concurrent connections**: 22-50% failure rate, with the errors
  explicitly including **`ConnectionRateLimitReached: Too many connected
  users`** — a real Supabase Realtime **server-side connection cap**, not a
  client-side or Docker-resource bottleneck (confirmed: the Realtime
  container's own logs show nothing for the failed attempts — they never
  reached the point of being accepted or rejected by application logic;
  the rate limiter rejects them earlier).

**This means the backlog's 500-concurrent target cannot be confirmed
against the local stack, or very likely a free-tier Supabase project
either** — both are plan-tier-limited on concurrent Realtime connections
well below 500. Confirming real capacity at 500 requires either a Supabase
plan tier whose Realtime connection limit supports it, or running this
script against the actual staging/production project once one exists at
the right tier — **an owner-actioned infrastructure decision, not
something more code can fix.**

## What to do with this before launch

1. Check the Supabase plan tier's documented Realtime concurrent-connection
   limit for whatever tier the production project will run on.
2. If it's below the ~500 target, either upgrade the plan or revise the
   target down (the backlog item's own wording: "confirm/adjust the number
   before running" — this run is exactly that confirmation, and the answer
   is "adjust, or upgrade the plan").
3. Re-run this script against the staging project once it exists
   (`docs/DEPLOYMENT.md`) to get a real number at production-equivalent
   infrastructure, not a local Docker container.
