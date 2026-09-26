# Postgres for local development, replacing the Supabase CLI's own container
# (Phase 10, docs/POSTGRES_MIGRATION_PLAN.md). Pinned to 17 to match the
# 17.6.1 image `supabase start` was running, so the schema this repo's 22
# migrations were verified against is the same major version.
#
# The only addition is pgTAP: the 15 files in supabase/tests/ are the proof
# that the RLS policies survive the move off Supabase, and they cannot run
# without it. The official image carries the PGDG apt repository, so the
# versioned package installs directly.
FROM postgres:17

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-17-pgtap \
  && rm -rf /var/lib/apt/lists/*
