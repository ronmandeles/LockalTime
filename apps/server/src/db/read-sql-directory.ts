import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

import type { MigrationFile } from './migration-runner';

// Filename order is the apply order, so the read is sorted here rather than
// left to the filesystem's own enumeration order, which is not guaranteed.
export const readSqlDirectory = async (directory: string): Promise<readonly MigrationFile[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.sql'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  return Promise.all(
    names.map(async (name) => ({
      name,
      sql: await readFile(path.join(directory, name), 'utf8'),
    })),
  );
};
