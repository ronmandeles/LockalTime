-- Phase 7 (Release Prep): account deletion, surfaced during task-writing as
-- a real (not merely theoretical) gap -- deleting auth.users cascades via
-- users_id_fkey (ON DELETE CASCADE, from the original users migration), but
-- every FK below was left at Postgres's default NO ACTION, which raises a
-- foreign-key-violation error rather than cascading. Before this migration,
-- deleting the account of anyone who had ever hosted/joined a session or
-- owned a venue would fail outright -- i.e. account deletion worked only
-- for a brand-new user with no history, not for a real one.
--
-- Design choice (CLAUDE.md's decided retention policy: "retained for the
-- life of the account, cascade-deleted on account deletion"), applied with
-- one deliberate carve-out:
--   * sessions.host_id -> CASCADE. A session is the host's created object;
--     deleting it (and everything that itself cascades from session_id,
--     already ON DELETE CASCADE since Phase 2) when the host's account
--     goes away is the same "your data disappears with you" rule already
--     applied everywhere else. This does mean OTHER participants' presence/
--     participant/attestation rows FOR THAT SPECIFIC SESSION disappear too
--     -- their aggregate stats (user_stats/user_streaks) are untouched,
--     since those are written once at session-close and don't depend on
--     the session row still existing.
--   * rewards_history is the one deliberate exception to "cascades with the
--     session": user_id CASCADEs (it's the row owner's own receipt), but
--     session_id is SET NULL rather than CASCADE, specifically so another
--     participant's own earned-points audit trail is never destroyed just
--     because the session's host deleted their account.
--   * venues.owner_id -> made nullable, SET NULL (not CASCADE). A venue is
--     a shared B2B asset that other users' sessions may still reference
--     (sessions.venue_id has no cascade and would otherwise block the
--     whole deletion); losing the owner reference is enough.
--   * sessions.ended_by -> SET NULL (already nullable; just adds the action).
--   * Every other bare user_id FK (session_host_assignments,
--     session_presence_intervals, session_participants, device_attestations)
--     -> CASCADE: a participant deleting their own account should remove
--     their own rows from a session without needing the whole session
--     deleted.

alter table public.sessions
  drop constraint sessions_host_id_fkey,
  add constraint sessions_host_id_fkey
    foreign key (host_id) references public.users(id) on delete cascade;

alter table public.sessions
  drop constraint sessions_ended_by_fkey,
  add constraint sessions_ended_by_fkey
    foreign key (ended_by) references public.users(id) on delete set null;

alter table public.session_host_assignments
  drop constraint session_host_assignments_user_id_fkey,
  add constraint session_host_assignments_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.session_presence_intervals
  drop constraint session_presence_intervals_user_id_fkey,
  add constraint session_presence_intervals_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.session_participants
  drop constraint session_participants_user_id_fkey,
  add constraint session_participants_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.device_attestations
  drop constraint device_attestations_user_id_fkey,
  add constraint device_attestations_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.rewards_history
  drop constraint rewards_history_user_id_fkey,
  add constraint rewards_history_user_id_fkey
    foreign key (user_id) references public.users(id) on delete cascade;

alter table public.rewards_history
  drop constraint rewards_history_session_id_fkey,
  add constraint rewards_history_session_id_fkey
    foreign key (session_id) references public.sessions(id) on delete set null;

alter table public.venues
  alter column owner_id drop not null;

alter table public.venues
  drop constraint venues_owner_id_fkey,
  add constraint venues_owner_id_fkey
    foreign key (owner_id) references public.users(id) on delete set null;
