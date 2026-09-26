// Task 10.1's definition of done: the 22 migrations in supabase/migrations/
// and the 15 pgTAP files in supabase/tests/ run on plain Postgres, unchanged,
// with only db/bootstrap/ supplying the Supabase-shaped objects they expect.
//
// Requires the local stack: `docker compose -f db/docker-compose.yml up -d`.
import { randomUUID } from 'node:crypto';
import path from 'node:path';

import { Client } from 'pg';

import { applyMigrations } from '../src/db/apply-migrations';
import { readSqlDirectory } from '../src/db/read-sql-directory';
import { runTapFile } from '../src/db/run-tap-file';

const ADMIN_URL =
  process.env.POSTGRES_ADMIN_URL ?? 'postgres://postgres:postgres@127.0.0.1:55432/lockaltime';

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const BOOTSTRAP_DIR = path.join(REPO_ROOT, 'db', 'bootstrap');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const TESTS_DIR = path.join(REPO_ROOT, 'supabase', 'tests');

// A scratch database per run, so "fresh database" is literal and the dev
// database is never touched.
const scratchName = `lockaltime_migrations_${randomUUID().replace(/-/g, '')}`;
const scratchUrl = new URL(ADMIN_URL);
scratchUrl.pathname = `/${scratchName}`;

let scratch: Client;

const connect = async (url: string): Promise<Client> => {
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
};

beforeAll(async () => {
  let admin: Client;
  try {
    admin = await connect(ADMIN_URL);
  } catch (error) {
    throw new Error(
      `Cannot reach Postgres at ${ADMIN_URL}. Start the stack with ` +
        `\`docker compose -f db/docker-compose.yml up -d\`. Cause: ${String(error)}`,
    );
  }

  await admin.query(`create database ${scratchName}`);
  await admin.end();

  scratch = await connect(scratchUrl.toString());
  // Supplied by db/Dockerfile; the 15 test files assume it the way they
  // assumed the Supabase CLI's own test database did.
  await scratch.query('create extension if not exists pgtap');
}, 120_000);

afterAll(async () => {
  await scratch?.end();
  const admin = await connect(ADMIN_URL);
  await admin.query(`drop database if exists ${scratchName} with (force)`);
  await admin.end();
}, 60_000);

describe('applyMigrations against a fresh database', () => {
  it('applies every migration file in supabase/migrations', async () => {
    const onDisk = await readSqlDirectory(MIGRATIONS_DIR);

    const result = await applyMigrations(scratch, {
      bootstrapDir: BOOTSTRAP_DIR,
      migrationsDir: MIGRATIONS_DIR,
    });

    expect(result.ok).toBe(true);
    expect(result.ok && result.applied).toEqual(onDisk.map((file) => file.name));
    expect(onDisk.length).toBeGreaterThanOrEqual(22);
  }, 180_000);

  it('records what it applied so a second run is a no-op', async () => {
    const result = await applyMigrations(scratch, {
      bootstrapDir: BOOTSTRAP_DIR,
      migrationsDir: MIGRATIONS_DIR,
    });

    expect(result).toEqual({ ok: true, applied: [] });
  }, 60_000);

  it('creates the tables the mobile app and the API both read', async () => {
    const { rows } = await scratch.query<{ table_name: string }>(
      `select table_name from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE'`,
    );
    const tables = rows.map((row) => row.table_name);

    expect(tables).toEqual(
      expect.arrayContaining([
        'users',
        'sessions',
        'session_participants',
        'session_presence_intervals',
        'rewards_history',
        'user_stats',
        'user_streaks',
        'milestones',
        'friendships',
        'venues',
        'device_tokens',
      ]),
    );
  });

  it('leaves row-level security enabled on every public table it created', async () => {
    const { rows } = await scratch.query<{ relname: string }>(
      `select c.relname from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity = false`,
    );

    expect(rows.map((row) => row.relname)).toEqual([]);
  });
});

describe('the pgTAP suite on plain Postgres', () => {
  it('finds all 15 test files', async () => {
    const files = await readSqlDirectory(TESTS_DIR);

    expect(files).toHaveLength(15);
  });

  // One test per file would read better in the output, but the file list is
  // only known asynchronously and Jest needs its cases defined synchronously.
  // Every failure is named in the message instead, so a red run still says
  // which file and which assertion.
  it('passes every assertion in every file', async () => {
    const files = await readSqlDirectory(TESTS_DIR);

    const results = [];
    for (const file of files) {
      results.push({ name: file.name, summary: await runTapFile(scratch, file.sql) });
    }

    const failed = results.filter((result) => !result.summary.ok);
    const report = failed
      .map((result) => {
        const { planned, ran, failures } = result.summary;
        const detail =
          failures.length > 0
            ? failures.map((failure) => `#${failure.number} ${failure.description}`).join('; ')
            : `planned ${String(planned)}, ran ${ran}`;
        return `${result.name}: ${detail}`;
      })
      .join('\n');

    expect(report).toBe('');
    expect(results.every((result) => result.summary.ok)).toBe(true);
  }, 180_000);
});
