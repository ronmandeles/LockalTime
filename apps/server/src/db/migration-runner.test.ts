import type { AppliedMigration, MigrationFile } from './migration-runner';
import { checksumOf, planMigrations } from './migration-runner';

const file = (name: string, sql = `-- ${name}`): MigrationFile => ({ name, sql });

const applied = (name: string, sql = `-- ${name}`): AppliedMigration => ({
  name,
  checksum: checksumOf(sql),
});

describe('checksumOf', () => {
  it('returns the same checksum for identical SQL', () => {
    expect(checksumOf('select 1;')).toBe(checksumOf('select 1;'));
  });

  it('returns a different checksum when the SQL changes', () => {
    expect(checksumOf('select 1;')).not.toBe(checksumOf('select 2;'));
  });

  // The repo stores files LF in git but Windows working trees materialize
  // CRLF (root .prettierrc sets endOfLine: "auto" for exactly this reason).
  // Without normalizing, every migration applied on Windows would read as
  // drifted on Linux CI and vice versa — the ledger would be useless across
  // the two machines this project actually runs on.
  it('ignores line-ending differences between CRLF and LF', () => {
    expect(checksumOf('select 1;\r\nselect 2;\r\n')).toBe(checksumOf('select 1;\nselect 2;\n'));
  });

  it('does not ignore meaningful whitespace inside a statement', () => {
    expect(checksumOf("select 'a b';")).not.toBe(checksumOf("select 'ab';"));
  });
});

describe('planMigrations', () => {
  it('returns every file as pending when nothing has been applied', () => {
    const plan = planMigrations([file('002_b.sql'), file('001_a.sql')], []);

    expect(plan).toEqual({
      ok: true,
      pending: [file('001_a.sql'), file('002_b.sql')],
    });
  });

  it('orders pending migrations by filename, not by the order given', () => {
    const plan = planMigrations(
      [file('20260807000000_c.sql'), file('20260718192504_a.sql'), file('20260726225600_b.sql')],
      [],
    );

    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.pending.map((pending) => pending.name)).toEqual([
      '20260718192504_a.sql',
      '20260726225600_b.sql',
      '20260807000000_c.sql',
    ]);
  });

  it('excludes migrations that are already recorded in the ledger', () => {
    const plan = planMigrations([file('001_a.sql'), file('002_b.sql')], [applied('001_a.sql')]);

    expect(plan.ok).toBe(true);
    expect(plan.ok && plan.pending.map((pending) => pending.name)).toEqual(['002_b.sql']);
  });

  it('returns no pending migrations when every file is already applied', () => {
    const plan = planMigrations(
      [file('001_a.sql'), file('002_b.sql')],
      [applied('001_a.sql'), applied('002_b.sql')],
    );

    expect(plan).toEqual({ ok: true, pending: [] });
  });

  // supabase-integration's forward-only rule, enforced in code rather than
  // trusted to discipline: editing an applied migration leaves every other
  // database that already ran the old text silently diverged.
  it('rejects the plan when an applied migration’s SQL has since been edited', () => {
    const plan = planMigrations(
      [file('001_a.sql', 'select 2;')],
      [applied('001_a.sql', 'select 1;')],
    );

    expect(plan).toEqual({ ok: false, reason: 'checksum_drift', name: '001_a.sql' });
  });

  it('rejects the plan when an applied migration’s file no longer exists', () => {
    const plan = planMigrations([file('002_b.sql')], [applied('001_a.sql')]);

    expect(plan).toEqual({ ok: false, reason: 'missing_applied_file', name: '001_a.sql' });
  });

  // A backdated migration would apply after its successors on this database
  // and before them on a fresh one — two different schemas from one ledger.
  it('rejects a new migration whose timestamp precedes one already applied', () => {
    const plan = planMigrations([file('001_a.sql'), file('002_b.sql')], [applied('002_b.sql')]);

    expect(plan).toEqual({ ok: false, reason: 'out_of_order', name: '001_a.sql' });
  });

  it('reports drift ahead of ordering when a plan breaks both rules', () => {
    const plan = planMigrations(
      [file('001_a.sql'), file('002_b.sql', 'select 99;')],
      [applied('002_b.sql', 'select 1;')],
    );

    expect(plan).toEqual({ ok: false, reason: 'checksum_drift', name: '002_b.sql' });
  });
});
