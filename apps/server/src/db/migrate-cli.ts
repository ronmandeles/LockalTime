import path from 'node:path';

import { Client } from 'pg';

import { applyMigrations } from './apply-migrations';

// `npm run db:migrate` — the replacement for `supabase db push` against the
// local stack (Phase 10, task 10.1). Runtime shell only: everything worth
// testing lives in apply-migrations.ts and migration-runner.ts.

const DEFAULT_URL = 'postgres://postgres:postgres@127.0.0.1:55432/lockaltime';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const REJECTION_HELP: Record<string, string> = {
  checksum_drift:
    'An already-applied migration has been edited. Migrations are forward-only: ' +
    'revert the edit and add a new migration instead.',
  missing_applied_file: 'A migration recorded in the ledger is no longer on disk.',
  out_of_order:
    'A new migration is timestamped before one that already ran. Rename it with a ' +
    'current timestamp so its order is the same on every database.',
};

const main = async (): Promise<number> => {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
  await client.connect();

  try {
    const result = await applyMigrations(client, {
      bootstrapDir: path.join(REPO_ROOT, 'db', 'bootstrap'),
      migrationsDir: path.join(REPO_ROOT, 'supabase', 'migrations'),
    });

    if (!result.ok) {
      console.error(`Refusing to migrate: ${result.reason} on ${result.name}`);
      console.error(REJECTION_HELP[result.reason] ?? '');
      return 1;
    }

    if (result.applied.length === 0) {
      console.log('Already up to date.');
      return 0;
    }

    for (const name of result.applied) {
      console.log(`applied ${name}`);
    }
    console.log(`${result.applied.length} migration(s) applied.`);
    return 0;
  } finally {
    await client.end();
  }
};

main()
  .then((code) => process.exit(code))
  .catch((error: unknown) => {
    console.error(String(error));
    process.exit(1);
  });
