import path from 'node:path';

import { Client } from 'pg';

import { readSqlDirectory } from './read-sql-directory';
import { runTapFile } from './run-tap-file';

// `npm run db:test` — the replacement for `supabase test db` (Phase 10, task
// 10.1). Runs every file in supabase/tests/ and exits non-zero if any
// assertion failed or any file failed to produce its planned assertions.

const DEFAULT_URL = 'postgres://postgres:postgres@127.0.0.1:55432/lockaltime';
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');

const main = async (): Promise<number> => {
  const client = new Client({ connectionString: process.env.DATABASE_URL ?? DEFAULT_URL });
  await client.connect();

  try {
    await client.query('create extension if not exists pgtap');

    const files = await readSqlDirectory(path.join(REPO_ROOT, 'supabase', 'tests'));
    let failedFiles = 0;
    let totalAssertions = 0;
    let totalPassed = 0;

    for (const file of files) {
      const summary = await runTapFile(client, file.sql);
      totalAssertions += summary.ran;
      totalPassed += summary.passed;

      if (summary.ok) {
        console.log(`ok   ${file.name} (${summary.passed}/${summary.ran})`);
        continue;
      }

      failedFiles += 1;
      console.error(`FAIL ${file.name} (planned ${String(summary.planned)}, ran ${summary.ran})`);
      for (const failure of summary.failures) {
        console.error(`     #${failure.number} ${failure.description}`);
      }
    }

    console.log(
      `\n${files.length - failedFiles}/${files.length} files, ` +
        `${totalPassed}/${totalAssertions} assertions passed.`,
    );
    return failedFiles === 0 ? 0 : 1;
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
