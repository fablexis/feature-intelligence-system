import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { schema } from './schema';

export const DB_PATH = process.env.DATABASE_URL ?? './data/fis.db';

/**
 * Opens a SQLite connection with the pragmas this app depends on.
 * `foreign_keys` is OFF by default in SQLite and must be set per connection —
 * without it the evidence/problem references in the schema are not enforced.
 */
export function openSqlite(path: string = DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  return sqlite;
}

export function createDb(path: string = DB_PATH) {
  return drizzle(openSqlite(path), { schema });
}

/** Process-wide connection for the Next.js server. */
export const db = createDb();

export type Db = ReturnType<typeof createDb>;
export { schema };
