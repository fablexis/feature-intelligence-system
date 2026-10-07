import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { openSqlite } from './index';
import {
  TABLE_NAMES,
  accounts,
  evidenceLinks,
  problems,
  requests,
  schema,
} from './schema';

/** Applies the committed migrations to a throwaway in-memory database. */
function freshDb() {
  const sqlite = openSqlite(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { sqlite, db };
}

describe('schema', () => {
  it('exports all ten tables from ARCHITECTURE.md', () => {
    expect(Object.keys(schema)).toHaveLength(10);
    expect(TABLE_NAMES).toHaveLength(10);
  });

  it('migrates cleanly onto an empty database', () => {
    const { sqlite } = freshDb();
    const found = sqlite
      .prepare(
        "select name from sqlite_master where type='table' and name not like 'sqlite_%' and name not like '__drizzle%'",
      )
      .all() as { name: string }[];
    expect(found.map((t) => t.name).sort()).toEqual([...TABLE_NAMES].sort());
    sqlite.close();
  });

  it('round-trips a request attached to a problem as evidence', () => {
    const { sqlite, db } = freshDb();

    const [account] = db
      .insert(accounts)
      .values({ name: 'Northwind', segment: 'enterprise', arrCents: 4_200_000 })
      .returning()
      .all();
    const [problem] = db
      .insert(problems)
      .values({
        statement: 'Finance cannot reconcile without re-keying data by hand',
        jobToBeDone: 'Move billing figures into the finance system',
        currentWorkaround: 'Copies numbers into a spreadsheet manually',
        blockedOutcome: 'Month-end close slips by two days',
      })
      .returning()
      .all();
    const [request] = db
      .insert(requests)
      .values({
        title: 'Add CSV export',
        bodyRaw: 'We need a CSV export button on the billing page.',
        submitterKind: 'customer',
        source: 'customer_direct',
        accountId: account.id,
      })
      .returning()
      .all();
    db.insert(evidenceLinks)
      .values({ requestId: request.id, problemId: problem.id, createdBy: 'ai', confidence: 0.91 })
      .run();

    const links = db.select().from(evidenceLinks).all();
    expect(links).toHaveLength(1);
    expect(links[0].active).toBe(true);
    // body_raw is stored verbatim — the abstraction indexes it, never replaces it
    expect(db.select().from(requests).all()[0].bodyRaw).toContain('CSV export button');
    sqlite.close();
  });

  it('enforces foreign keys, so evidence cannot dangle', () => {
    const { sqlite, db } = freshDb();
    expect(() =>
      db
        .insert(evidenceLinks)
        .values({ requestId: 'nope', problemId: 'nope', createdBy: 'ai' })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
    sqlite.close();
  });
});
