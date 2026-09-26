import type { ClientBase, QueryResult } from 'pg';

import type { TapSummary } from './tap-parser';
import { parseTapOutput } from './tap-parser';

// Runs one pgTAP file and reads its verdict — the reporting half of what
// `supabase test db` did (Phase 10, task 10.1).
//
// pgTAP returns its TAP lines as ordinary result rows, so the file is sent as
// a single multi-statement query and every row of every result is collected in
// order. Each file already wraps itself in begin/rollback, so nothing it does
// persists.

const rowsToTapLines = (results: readonly QueryResult[]): string =>
  results
    .flatMap((result) => result.rows ?? [])
    .map((row: unknown) => {
      const values = Object.values(row as Record<string, unknown>);
      return String(values[0] ?? '');
    })
    .join('\n');

export const runTapFile = async (client: ClientBase, sql: string): Promise<TapSummary> => {
  try {
    const result = await client.query(sql);
    return parseTapOutput(rowsToTapLines(Array.isArray(result) ? result : [result]));
  } catch (error) {
    // A file that aborts mid-way leaves the connection in a failed
    // transaction, which would fail every later file for the wrong reason.
    await client.query('rollback').catch(() => undefined);

    // Parsing the error text keeps one path into TapSummary: no plan and no
    // assertions is exactly what parseTapOutput treats as a failure, so a
    // broken file can never report green.
    return parseTapOutput(String(error));
  }
};
