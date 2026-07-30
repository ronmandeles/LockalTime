-- Phase 7 (Release Prep) — standalone grant-verification check, run against
-- a freshly-migrated Supabase project (staging or production) via:
--   npx supabase db execute --linked --file scripts/verify-service-role-grants.sql
--
-- Why this exists: docs/MANUAL_QA.md already documents this exact miss
-- TWICE for the production project — a brand-new Supabase table/function
-- carries ZERO Data API privileges for any role, service_role included,
-- until a migration GRANTs them explicitly. Every migration in this repo
-- has grabbed the right grant by the time it merged, so `supabase test db`
-- (pgTAP, against the LOCAL stack) already proves this — but a staging/prod
-- project is a separate Postgres instance `db push` populates from the same
-- migration files, and nothing has ever actually re-run this check against
-- one of *those* until now. `has_table_privilege`/`has_function_privilege`
-- are built-in Postgres functions (not a pgTAP extension), so this needs no
-- special setup beyond a normal SQL connection.

do $$
declare
  missing_count int := 0;
  r record;
begin
  create temporary table expected_table_grants (tbl text, priv text) on commit drop;
  insert into expected_table_grants (tbl, priv) values
    ('public.sessions', 'select'), ('public.sessions', 'insert'), ('public.sessions', 'update'),
    ('public.session_host_assignments', 'select'), ('public.session_host_assignments', 'insert'),
      ('public.session_host_assignments', 'update'),
    ('public.session_presence_intervals', 'select'), ('public.session_presence_intervals', 'insert'),
      ('public.session_presence_intervals', 'update'),
    ('public.session_participants', 'select'), ('public.session_participants', 'insert'),
      ('public.session_participants', 'update'),
    ('public.device_attestations', 'select'), ('public.device_attestations', 'insert'),
    ('public.rewards_history', 'select'), ('public.rewards_history', 'insert'),
    ('public.user_streaks', 'select'), ('public.user_streaks', 'update'),
    ('public.user_stats', 'select'),
    ('public.user_stats_daily', 'select'),
    ('public.user_milestones', 'select'),
    ('public.milestones', 'select'),
    ('public.users', 'select'),
    ('public.venues', 'select'), ('public.venues', 'insert'), ('public.venues', 'update'),
    ('public.device_tokens', 'select'),
    ('public.friend_requests', 'select'),
    ('public.friendships', 'select');

  for r in
    select tbl, priv
    from expected_table_grants
    where not has_table_privilege('service_role', tbl, priv)
  loop
    raise warning 'MISSING table grant: service_role % on %', r.priv, r.tbl;
    missing_count := missing_count + 1;
  end loop;

  create temporary table expected_function_grants (fn text) on commit drop;
  insert into expected_function_grants (fn) values
    ('public.join_session(uuid, uuid, text, int)'),
    ('public.rejoin_session(uuid, uuid, int)'),
    ('public.apply_session_stats(uuid, uuid, timestamptz, int, text)'),
    ('public.join_venue_session(uuid, text, uuid, int)'),
    ('public.get_venue_metrics(uuid, timestamptz)'),
    ('public.claim_streak_risk_notifications(timestamptz, int)'),
    ('public.send_friend_request(uuid, uuid)'),
    ('public.respond_to_friend_request(uuid, uuid, boolean)');

  for r in
    select fn
    from expected_function_grants
    where not has_function_privilege('service_role', fn, 'execute')
  loop
    raise warning 'MISSING function grant: service_role EXECUTE on %', r.fn;
    missing_count := missing_count + 1;
  end loop;

  if missing_count > 0 then
    raise exception '% service_role grant(s) missing — see warnings above. This project''s migrations are out of sync with what apps/server actually needs; check for a migration that failed partway or was never pushed.', missing_count;
  end if;

  raise notice 'All % expected service_role grants are present.',
    (select count(*) from expected_table_grants) + (select count(*) from expected_function_grants);
end $$;
