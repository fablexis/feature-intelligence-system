/**
 * One command that puts the demo database back to its canonical state, between
 * Loom takes or after any amount of clicking.
 *
 *   npm run demo:reset
 *
 * **It wipes the tables rather than the file, and that is the whole trick.**
 * `npm run dev` opens one long-lived SQLite connection at import time. Delete
 * the file underneath it and the server keeps writing to the unlinked inode:
 * the reset appears to work, the pages keep serving the old data, and the next
 * take is filmed against a database nobody can see. (Found the hard way while
 * testing this script.) Clearing the rows in place keeps the file, so a server
 * that is already running picks the new state up on the next request and the
 * reset can be run mid-session.
 *
 * **Why it does not just call `resetDerived`.** That helper deletes `problems`
 * but not `ai_decisions`, whose `problem_id` references them, so `npm run
 * ingest` fails the foreign key the moment `npm run score` has ever run — and
 * because the reset is not transactional, the failure leaves 23 problems with
 * zero evidence behind it. Both are recorded as defects in
 * [TASKS E3](../docs/TASKS.md#e3--review--hardening). Fixing them belongs in E3
 * with tests; a demo reset that quietly depends on the broken path does not. So
 * this clears **every** table in one transaction, including `ai_decisions` and
 * the live requests a demo adds, and then replays the documented quickstart —
 * the same sequence a reviewer runs on a fresh clone.
 *
 * It spends nothing: every model output is replayed from committed fixtures, so
 * the result is byte-identical every time, which is the property a second take
 * depends on.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { DB_PATH, openSqlite } from '../src/db/index';

/**
 * Child-first order, so each delete runs after whatever references it. Chosen
 * explicitly rather than by switching foreign keys off: if a future table makes
 * this order wrong, the right outcome is a loud failure here, not a silent
 * orphan in the demo data.
 */
const TABLES = [
  'ai_decisions',
  'dedupe_suggestions',
  'score_runs',
  'human_overrides',
  'problem_links',
  'supports',
  'evidence_links',
  'problems',
  'requests',
  'accounts',
] as const;

const STEPS = [
  ['scripts/seed.ts', 'load accounts and raw requests — no groupings'],
  ['scripts/ingest.ts', 'form the problems by reading the requests'],
  ['scripts/score.ts', 'estimate the factors behind each band'],
] as const;

const quiet = process.argv.includes('--quiet');

function run(script: string, label: string) {
  process.stdout.write(`→ ${label}\n`);
  const result = spawnSync(process.execPath, [require.resolve('tsx/cli'), script], {
    stdio: quiet ? ['ignore', 'ignore', 'inherit'] : 'inherit',
    // The replay provider is the point: no key, no network, no quota.
    env: { ...process.env, AI_PROVIDER: process.env.AI_PROVIDER ?? 'replay' },
  });
  if (result.status !== 0) {
    console.error(`\ndemo:reset failed at ${script} (exit ${result.status ?? 'signal'})`);
    process.exit(result.status ?? 1);
  }
}

// A fresh clone has no file and no schema yet; migrate is idempotent, so it is
// safe to run either way and is the only step that must come before the wipe.
if (!existsSync(DB_PATH)) {
  process.stdout.write(`${DB_PATH} does not exist yet\n`);
}
run('scripts/migrate.ts', 'make sure the schema is current');

const sqlite = openSqlite();
const cleared: string[] = [];
sqlite.transaction(() => {
  for (const table of TABLES) {
    const { n } = sqlite.prepare(`select count(*) as n from ${table}`).get() as { n: number };
    if (n > 0) cleared.push(`${table} ${n}`);
    sqlite.prepare(`delete from ${table}`).run();
  }
})();
sqlite.close();
process.stdout.write(
  cleared.length > 0 ? `cleared in place: ${cleared.join(' · ')}\n` : 'database was already empty\n',
);

for (const [script, label] of STEPS) run(script, label);

/**
 * Assert the canonical state rather than claiming it. These are the numbers
 * DEMO.md, LOOM_SCRIPT.md and the README quote, so a reset that silently
 * produced different ones would be actively harmful: a take would be filmed
 * against data that does not match the script being read.
 */
const check = openSqlite();
const actual = check
  .prepare(
    `select
       (select count(*) from requests)                              as requests,
       (select count(*) from problems)                              as problems,
       (select count(*) from evidence_links where active = 1)       as evidence,
       (select count(*) from evidence_links where needs_review = 1) as flagged,
       (select count(*) from score_runs)                            as scored,
       (select count(*) from human_overrides)                       as overrides,
       (select count(*) from supports)                              as supports,
       (select count(*) from requests where degraded = 1)           as degraded`,
  )
  .get() as Record<keyof typeof EXPECTED, number>;
check.close();

const EXPECTED = {
  requests: 55,
  problems: 23,
  evidence: 55,
  flagged: 11,
  scored: 23,
  overrides: 0,
  supports: 0,
  degraded: 0,
};

process.stdout.write(
  `\n${actual.requests} requests · ${actual.problems} problems · ${actual.evidence} attached` +
    ` · ${actual.flagged} awaiting review · ${actual.scored} scored` +
    ` · ${actual.overrides} band changes · ${actual.supports} “us too” · ${actual.degraded} degraded\n`,
);

const drift = Object.entries(EXPECTED).filter(
  ([key, want]) => actual[key as keyof typeof EXPECTED] !== want,
);
if (drift.length > 0) {
  console.error('\ndemo:reset did NOT reach the canonical state:');
  for (const [key, want] of drift) {
    console.error(`  ${key}: expected ${want}, got ${actual[key as keyof typeof EXPECTED]}`);
  }
  console.error('Do not film against this. Check fixtures/ and config/thresholds.json.');
  process.exit(1);
}

process.stdout.write('canonical — safe to film. A running `npm run dev` needs no restart.\n');
