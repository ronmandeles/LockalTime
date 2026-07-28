-- Phase 7 (Release Prep): records when a user first accepted the
-- Terms of Service / Privacy Policy. Null means "never recorded" —
-- existing users are grandfathered as null rather than backfilled, since
-- there's no real acceptance event to backfill with.
--
-- Not money-equivalent logic (CLAUDE.md) and not a security boundary: the
-- actual "you must pass this before using the app" gating lives in the
-- client UI, same as onboarding/permission-priming's own store flags. A
-- direct client-side write is therefore the right shape, same posture as
-- users.timezone/users.locale (see docs/DATABASE.md) rather than a Node
-- endpoint — self-reporting the acceptance timestamp has no privilege
-- implication worth a round trip through the server.

alter table public.users add column tos_accepted_at timestamptz;

grant update (display_name, avatar_url, timezone, locale, username, tos_accepted_at)
  on public.users to authenticated;
