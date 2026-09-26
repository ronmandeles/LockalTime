import type { ClientBase } from 'pg';

import type { AppliedMigration, MigrationPlanRejection } from './migration-runner';
import { checksumOf, planMigrations } from './migration-runner';
import { readSqlDirectory } from './read-sql-directory';

// IO shell around migration-runner's pure planner — the replacement for
// `supabase db push` (Phase 10, task 10.1).

// The ledger lives in its own schema rather than public on purpose: every
// table the migrations create has RLS enabled, and an un-policied bookkeeping
// table sitting in public would be a permanent exception to that rule (and to
// the test that asserts it).
const LEDGER_SCHEMA = 'migrations';
const LEDGER = `${LEDGER_SCHEMA}.history`;

export interface ApplyMigrationsOptions {
  readonly migrationsDir: string;
  // Idempotent SQL applied before the ledger exists. Task 10.2 removes the
  // only current use, db/bootstrap/.
  readonly bootstrapDir?: string;
}

export type ApplyMigrationsResult =
  | { readonly ok: true; readonly applied: readonly string[] }
  | { readonly ok: false; readonly reason: MigrationPlanRejection; readonly name: string };

export const applyMigrations = async (
  client: ClientBase,
  options: ApplyMigrationsOptions,
): Promise<ApplyMigrationsResult> => {
  if (options.bootstrapDir !== undefined) {
    for (const file of await readSqlDirectory(options.bootstrapDir)) {
      await client.query(file.sql);
    }
  }

  await client.query(`create schema if not exists ${LEDGER_SCHEMA}`);
  await client.query(`create table if not exists ${LEDGER} (
    name       text primary key,
    checksum   text not null,
    applied_at timestamptz not null default now()
  )`);

  const files = await readSqlDirectory(options.migrationsDir);
  const { rows } = await client.query<AppliedMigration>(
    `select name, checksum from ${LEDGER} order by name`,
  );

  const plan = planMigrations(files, rows);
  if (!plan.ok) {
    return plan;
  }

  const applied: string[] = [];
  for (const file of plan.pending) {
    // One transaction per migration, so a failure leaves the database at the
    // last complete migration rather than halfway through a broken one. Safe
    // for all 22 files here — none uses CREATE INDEX CONCURRENTLY or anything
    // else that cannot run inside a transaction block.
    await client.query('begin');
    try {
      await client.query(file.sql);
      await client.query(`insert into ${LEDGER} (name, checksum) values ($1, $2)`, [
        file.name,
        checksumOf(file.sql),
      ]);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Migration ${file.name} failed and was rolled back: ${String(error)}`);
    }
    applied.push(file.name);
  }

  return { ok: true, applied };
};
