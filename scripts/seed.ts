/**
 * Loads the demo corpus: accounts and raw requests, nothing else.
 *
 * This script deliberately does NOT import src/seed/labels.ts, and neither does
 * the module that does the inserting. Problems and evidence links are created
 * only by running the intake pipeline over these requests (C3), so the database
 * never contains ground truth. See docs/TASKS.md#c6 for the reasoning.
 *
 * Idempotent: ids are derived from the fixture slugs, and inserts are
 * conflict-tolerant, so re-running changes nothing.
 */
import { readFileSync } from 'node:fs';
import { sql } from 'drizzle-orm';
import { insertCorpus } from '../src/seed/corpus';
import { DB_PATH, createDb } from '../src/db/index';
import { problems } from '../src/db/schema';

const db = createDb();

insertCorpus(db);

const count = (table: string) =>
  (db.get<{ n: number }>(sql.raw(`select count(*) as n from ${table}`)) ?? { n: 0 }).n;

const strategy = JSON.parse(readFileSync('./config/strategy.json', 'utf8'));

console.log(`seeded ${DB_PATH}`);
console.log(`  accounts  ${count('accounts')}`);
console.log(`  requests  ${count('requests')}`);
console.log(`  problems  ${count('problems')}  (formed by the pipeline, not seeded — C3)`);
console.log(`  strategy  ${strategy.company}, ${strategy.goals.length} goals`);

if (count('problems') === 0) {
  console.log('\nNext: C3 adds `npm run ingest` to form problems from these requests.');
}

void problems;
