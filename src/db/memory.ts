/**
 * A migrated, empty database that exists only for the duration of one process.
 *
 * Two callers, for the same reason: the eval harness must not touch
 * `data/fis.db` (measuring is read-shaped, but the pipeline writes and
 * `resetDerived` deletes, so running it against the demo database would discard
 * human actions a reviewer had taken), and tests want a real schema without a
 * file on disk. A measurement or a test that mutates its subject is a worse
 * measurement or test.
 *
 * `src/db/index` is deliberately not imported for its connection helpers: that
 * module opens a process-wide handle to the demo database as a side effect of
 * being imported, which is exactly what this file exists to avoid. The type is
 * imported, which is erased.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from './index';
import { schema } from './schema';

export const MIGRATIONS_FOLDER = './drizzle';

export function createMemoryDb(migrationsFolder = MIGRATIONS_FOLDER): Db {
  const sqlite = new Database(':memory:');
  // Off by default in SQLite, and the schema's references are load-bearing.
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
