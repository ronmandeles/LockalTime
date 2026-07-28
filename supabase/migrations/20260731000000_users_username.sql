-- Phase 6.5 task 1: users.username + signup-trigger auto-generation.
-- Test-first contract: supabase/tests/users_trigger_test.sql (existing
-- file extended, not a new one -- this modifies handle_new_user(), the
-- exact function that file already tests).

-- ============================================================
-- USERS: username -- Phase 6.5's discovery mechanism (owner decision:
-- search by username, like Instagram/Facebook) needs every user to have
-- one from the moment they exist, not just users who later set one by
-- hand. Unique + not null; backfills any pre-existing rows so this
-- migration stays correct against a populated table, not just a fresh one.
-- Extends the existing column-scoped UPDATE grant (schema-ready for a
-- future "edit your username" screen; none built this phase).
-- ============================================================
alter table public.users add column username text;

update public.users
  set username = lower(regexp_replace(coalesce(nullif(display_name, ''), 'user'), '[^a-zA-Z0-9]', '', 'g'))
  where username is null;

-- Resolve any collisions the backfill above just created (two pre-existing
-- rows sharing a display_name) before the unique constraint below.
do $$
declare
  v_row record;
  v_suffix int;
  v_candidate text;
begin
  for v_row in
    select id, username,
           row_number() over (partition by username order by created_at) as rn
      from public.users
  loop
    if v_row.rn > 1 then
      v_suffix := v_row.rn - 1;
      v_candidate := v_row.username || v_suffix::text;
      while exists (select 1 from public.users where username = v_candidate) loop
        v_suffix := v_suffix + 1;
        v_candidate := v_row.username || v_suffix::text;
      end loop;
      update public.users set username = v_candidate where id = v_row.id;
    end if;
  end loop;
end $$;

alter table public.users alter column username set not null;
alter table public.users add constraint users_username_key unique (username);

revoke update on public.users from authenticated;
grant update (display_name, avatar_url, timezone, locale, username) on public.users to authenticated;

-- ============================================================
-- HANDLE_NEW_USER(): re-created (same signature -- a trigger function
-- takes no arguments, so there's no risk of the CREATE OR REPLACE
-- overload-collision gotcha Phase 6's apply_session_stats() hit) to also
-- derive a username: lowercase alphanumerics stripped from display_name
-- (falling back to 'user' if that strips to empty), with a numeric suffix
-- resolving collisions -- mirrors Instagram/Facebook-style auto-generated
-- handles. Retry-on-conflict, not just a pre-check-then-insert: two
-- concurrent signups sharing a display_name could both pass the same
-- "is this username free" check before either commits -- the same race
-- Phase 5.5's claim_streak_risk_notifications() and Phase 6's
-- join_venue_session() guard against elsewhere. An uncaught
-- unique_violation here would abort the whole signup, which this function
-- must never do (the same "never abort signup" guarantee display_name's
-- own derivation chain already has).
-- ============================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display_name text;
  v_username_base text;
  v_username text;
  v_suffix int := 0;
begin
  v_display_name := coalesce(
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'user'
  );

  v_username_base := lower(regexp_replace(v_display_name, '[^a-zA-Z0-9]', '', 'g'));
  if v_username_base = '' then
    v_username_base := 'user';
  end if;
  v_username := v_username_base;

  loop
    begin
      insert into public.users (id, display_name, username)
      values (new.id, v_display_name, v_username)
      on conflict (id) do nothing;
      exit;
    exception when unique_violation then
      v_suffix := v_suffix + 1;
      v_username := v_username_base || v_suffix::text;
    end;
  end loop;

  return new;
end;
$$;
