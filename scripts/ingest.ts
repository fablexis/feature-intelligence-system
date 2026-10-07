/**
 * The canonical ingest pass: forms problems from the seeded corpus by running
 * the intake pipeline once, in a fixed order.
 *
 * This is the pass that records adjudication fixtures. It is deliberately a
 * single deterministic sweep — formation is order-dependent, so it rebuilds
 * derived state rather than resuming.
 *
 *   npm run ingest -- --dry-run     count adjudication calls, spend nothing
 *   npm run ingest                  run it
 *
 * With AI_PROVIDER=replay it replays recorded verdicts and makes no calls.
 */
import { readFileSync } from 'node:fs';
import { asc, sql } from 'drizzle-orm';
import { aiConfig } from '../src/ai/config';
import { withDecisionLog } from '../src/ai/decisions';
import { createRecordingProvider, recordRpmGap } from '../src/ai/recording';
import { createReplayProvider } from '../src/ai/replay';
import { QuotaExhausted, sleep } from '../src/ai/retry';
import { createDb } from '../src/db/index';
import { requests } from '../src/db/schema';
import { ingestRequest, resetDerived } from '../src/pipeline/ingest';

const dryRun = process.argv.includes('--dry-run');
/** Smoke-test escape hatch: process only the first N requests. */
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const limit = limitArg ? Number(limitArg.split('=')[1]) : Infinity;
const cfg = aiConfig();
const thresholds = JSON.parse(readFileSync('./config/thresholds.json', 'utf8'));

const db = createDb();

// Deterministic order: creation time, then id for ties.
const corpus = db
  .select()
  .from(requests)
  .orderBy(asc(requests.createdAt), asc(requests.id))
  .all()
  .slice(0, limit);

if (corpus.length === 0) {
  console.error('no requests in the database — run `npm run seed` first');
  process.exit(1);
}

if (dryRun) {
  // Only the very first request has nothing to compare against, because
  // retrieval returns all problems with no similarity floor.
  const calls = corpus.length - 1;
  console.log('DRY RUN — no API calls made\n');
  console.log(`requests:            ${corpus.length}`);
  console.log(`adjudication calls:  ${calls}  (1 skipped: no problems exist yet)`);
  console.log(`model:               ${cfg.modelAdjudicate || '(unset)'}`);
  console.log(`T_auto:              ${thresholds.tAuto}  (${thresholds.tAutoBasis})`);
  console.log(`candidates:          ${thresholds.candidateLimit}`);
  console.log(`\n~${Math.ceil((calls * 21 + (calls / cfg.recordRpm) * 60) / 60)}min at ${cfg.recordRpm} rpm`);
  process.exit(0);
}

async function main() {
  let apiCalls = 0;
  const base =
    cfg.provider === 'gemini'
      ? createRecordingProvider(() => {
          apiCalls++;
        })
      : createReplayProvider();
  let currentRequestId: string | undefined;
  const provider = withDecisionLog(base, db, () => ({ requestId: currentRequestId }));

  console.log(`ingesting ${corpus.length} requests with ${base.name} (T_auto ${thresholds.tAuto})\n`);
  resetDerived(db);

  let attached = 0;
  let created = 0;
  let flagged = 0;
  let skipped = 0;
  let degraded = 0;
  let lastCallCount = 0;

  for (const [i, request] of corpus.entries()) {
    currentRequestId = request.id;
    const result = await ingestRequest(
      db,
      provider,
      {
        id: request.id,
        title: request.title,
        bodyRaw: request.bodyRaw,
        source: request.source,
      },
      {
        tAuto: thresholds.tAuto,
        candidateLimit: thresholds.candidateLimit === 'all' ? 'all' : Number(thresholds.candidateLimit),
        minSimilarity: Number(thresholds.minSimilarity ?? 0),
      },
    );

    // Throttle only when a call was actually made.
    if (cfg.provider === 'gemini' && apiCalls > lastCallCount) {
      lastCallCount = apiCalls;
      if (i < corpus.length - 1) await sleep(recordRpmGap());
    }

    if (result.adjudicationSkipped) skipped++;
    if (result.degraded) degraded++;

    if (result.resolution.kind === 'attach') {
      attached++;
      if (!result.resolution.auto) flagged++;
      const mark = result.resolution.auto ? 'auto ' : 'flag ';
      console.log(
        `  [${i + 1}/${corpus.length}] ${request.id} → ${mark} ${result.resolution.problemId} ` +
          `(${result.resolution.score.toFixed(3)}) ${result.candidates.length} cand`,
      );
    } else {
      created++;
      console.log(
        `  [${i + 1}/${corpus.length}] ${request.id} → NEW problem ` +
          `(${result.candidates.length} cand${result.adjudicationSkipped ? ', no model call' : ''})`,
      );
    }
  }

  const problemCount = (db.get<{ n: number }>(sql`select count(*) as n from problems`) ?? { n: 0 }).n;
  console.log(`\nproblems formed:     ${problemCount}`);
  console.log(`attached as evidence:${String(attached).padStart(4)}  (${flagged} flagged for PM review)`);
  console.log(`new problems:        ${String(created).padStart(4)}`);
  console.log(`model calls skipped: ${String(skipped).padStart(4)}`);
  console.log(`degraded:            ${String(degraded).padStart(4)}`);
  if (cfg.provider === 'gemini') console.log(`api calls spent:     ${String(apiCalls).padStart(4)}`);
}

main().catch((err) => {
  if (err instanceof QuotaExhausted) {
    console.error(`\nSTOPPED: ${err.message}`);
    console.error('Recorded verdicts are saved; re-running spends quota only on what is left.');
  } else {
    console.error(`ingest failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
