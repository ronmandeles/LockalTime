import { createHash } from 'node:crypto';

// Pure planning half of the migration runner that replaces `supabase db push`
// (Phase 10, docs/POSTGRES_MIGRATION_PLAN.md §3). The IO shell lives in
// migrate-cli.ts so this stays importable without touching a database.

export interface MigrationFile {
  readonly name: string;
  readonly sql: string;
}

export interface AppliedMigration {
  readonly name: string;
  readonly checksum: string;
}

export type MigrationPlanRejection = 'checksum_drift' | 'missing_applied_file' | 'out_of_order';

export type MigrationPlan =
  | { readonly ok: true; readonly pending: readonly MigrationFile[] }
  | { readonly ok: false; readonly reason: MigrationPlanRejection; readonly name: string };

// Line endings are normalized because this repo's files are stored LF in git
// but materialize CRLF in a Windows working tree (root .prettierrc sets
// endOfLine: "auto"). Hashing the raw bytes would make every migration read
// as drifted when the same repo is applied from Windows and from Linux CI.
export const checksumOf = (sql: string): string =>
  createHash('sha256').update(sql.replace(/\r\n/g, '\n'), 'utf8').digest('hex');

const byName = (a: { name: string }, b: { name: string }): number => a.name.localeCompare(b.name);

export const planMigrations = (
  files: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationPlan => {
  const filesByName = new Map(files.map((file) => [file.name, file]));

  // Integrity of what already ran comes first: if the ledger and the files
  // disagree, the pending set is not meaningful yet.
  for (const record of [...applied].sort(byName)) {
    const file = filesByName.get(record.name);
    if (file === undefined) {
      return { ok: false, reason: 'missing_applied_file', name: record.name };
    }
    if (checksumOf(file.sql) !== record.checksum) {
      return { ok: false, reason: 'checksum_drift', name: record.name };
    }
  }

  const appliedNames = new Set(applied.map((record) => record.name));
  const pending = [...files].sort(byName).filter((file) => !appliedNames.has(file.name));

  // A migration timestamped before one that already ran would apply after its
  // successors here and before them on a fresh database — one ledger, two
  // different schemas. Refuse rather than pick an order.
  const latestApplied = [...appliedNames].sort().pop();
  if (latestApplied !== undefined) {
    const backdated = pending.find((file) => file.name.localeCompare(latestApplied) < 0);
    if (backdated !== undefined) {
      return { ok: false, reason: 'out_of_order', name: backdated.name };
    }
  }

  return { ok: true, pending };
};
