/**
 * A migrated, empty database that exists only for the duration of one process.
 *
 * The eval harness must not touch `data/fis.db`. Measuring is a read-shaped
 * act, but the pipeline is not: forming problems writes, and `resetDerived`
 * deletes — so running the eval against the demo database would quietly
 * discard any human action a reviewer had taken in the UI. A measurement that
 * mutates its subject is also simply a worse measurement: this way the run is
 * reproducible from `src/seed` + `fixtures/` and nothing else.
 *
 * `src/db/index` is deliberately not imported for its connection helpers: that
 * module opens a process-wide handle to the demo database as a side effect of
 * being imported, which is exactly what this file exists to avoid. The type is
 * imported, which is erased.
 */
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { Db } from '../db/index';
import { schema } from '../db/schema';

export const MIGRATIONS_FOLDER = './drizzle';

export function createEvalDb(migrationsFolder = MIGRATIONS_FOLDER): Db {
  const sqlite = new Database(':memory:');
  // Off by default in SQLite, and the schema's references are load-bearing.
  sqlite.pragma('foreign_keys = ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder });
  return db;
}
