/**
 * Stage 6 — factor estimation, batched, with the arithmetic done locally.
 *
 *   npm run score -- --dry-run    count calls, spend nothing
 *   npm run score                 record estimates and append score_runs
 *
 * The C5 counterpart of `npm run ingest`: like adjudication, factor inputs
 * depend on which problems exist and what evidence hangs off them, so this
 * cannot be enumerated ahead of time by `npm run record`.
 *
 * With AI_PROVIDER=replay it replays recorded estimates and makes no calls,
 * which is also how the keyless demo gets its bands.
 */
import { asc } from 'drizzle-orm';
import { aiConfig } from '../src/ai/config';
import { withDecisionLog } from '../src/ai/decisions';
import { FACTOR_BATCH_SIZE, renderBudget } from '../src/ai/budget';
import { type FixtureEntry, loadFixtures, saveFixtures } from '../src/ai/fixtures';
import { createGeminiProvider } from '../src/ai/gemini';
import { fixtureKey } from '../src/ai/hash';
import { prompt } from '../src/ai/prompts';
import { createReplayProvider } from '../src/ai/replay';
import { QuotaExhausted, sleep, withRetry } from '../src/ai/retry';
import { recordRpmGap } from '../src/ai/recording';
import { createDb } from '../src/db/index';
import { problems } from '../src/db/schema';
import { loadWeights, scoreProblem } from '../src/scoring/score';
import { factorsInputFor, loadStrategy, recordRun } from '../src/scoring/runs';

const dryRun = process.argv.includes('--dry-run');
const cfg = aiConfig();
const db = createDb();
const weights = loadWeights();
const strategy = loadStrategy();

/**
 * Batch composition is fixed by sorting on problem id, so the same four
 * problems always travel together and a re-run reproduces the same calls.
 * Fixtures are keyed per problem, so a 24th problem adds one batch rather than
 * invalidating the other 23.
 */
const ids = db
  .select({ id: problems.id })
  .from(problems)
  .orderBy(asc(problems.id))
  .all()
  .map((p) => p.id);

if (ids.length === 0) {
  console.error('no problems to score — run `npm run seed` then `npm run ingest` first');
  process.exit(1);
}

const batches: string[][] = [];
for (let i = 0; i < ids.length; i += FACTOR_BATCH_SIZE) {
  batches.push(ids.slice(i, i + FACTOR_BATCH_SIZE));
}

const scorePrompt = prompt.factors();
const fixtures = loadFixtures();
const keyFor = (problemId: string) =>
  fixtureKey({
    stage: 'score',
    modelId: cfg.modelScore,
    promptVersion: scorePrompt.version,
    input: factorsInputFor(db, problemId, strategy),
  });

const alreadyRecorded = ids.filter((id) => fixtures.has(keyFor(id)));
/**
 * Pending batches keep their original number, so a resumed run's log lines
 * refer to the same batches the dry run listed. Renumbering them 1..n would
 * make "batch 2" mean different problems on different days.
 */
const pendingBatches = batches
  .map((problemIds, index) => ({ number: index + 1, problemIds }))
  .filter(({ problemIds }) => problemIds.some((id) => !fixtures.has(keyFor(id))));

if (dryRun) {
  console.log('DRY RUN — no API calls made\n');
  console.log(`problems:            ${ids.length}`);
  console.log(`batch size:          ${FACTOR_BATCH_SIZE}  (composition fixed by sorted problem id)`);
  console.log(`batches total:       ${batches.length}`);
  console.log(`already recorded:    ${alreadyRecorded.length} problem(s) — a re-run skips their batch`);
  console.log(`API CALLS TO SPEND:  ${pendingBatches.length}`);
  console.log(`model:               ${cfg.modelScore || '(unset)'}`);
  console.log(`prompt version:      ${scorePrompt.version}`);
  console.log(`weights:             ${weights.version}  (arithmetic is local — no model call)`);
  console.log(`api key present:     ${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'yes' : 'no'}`);
  console.log(`\n~${Math.ceil((pendingBatches.length * 25 + (pendingBatches.length / cfg.recordRpm) * 60) / 60)}min at ${cfg.recordRpm} rpm`);
  console.log(renderBudget(ids.length));
  for (const [i, batch] of batches.entries()) {
    const recorded = batch.every((id) => fixtures.has(keyFor(id)));
    console.log(`  batch ${i + 1}${recorded ? ' (recorded)' : ''}: ${batch.join(', ')}`);
  }
  process.exit(0);
}

const put = (entry: FixtureEntry) => {
  fixtures.set(entry.key, entry);
  saveFixtures(fixtures); // checkpoint per call, so a quota stop loses nothing
};

async function main() {
  let apiCalls = 0;
  const live = cfg.provider === 'gemini';
  const gemini = live ? createGeminiProvider() : null;
  const replay = createReplayProvider();
  let currentProblemId: string | undefined;
  const logged = withDecisionLog(replay, db, () => ({ problemId: currentProblemId }));

  console.log(
    `scoring ${ids.length} problem(s) in ${batches.length} batch(es) of ${FACTOR_BATCH_SIZE} ` +
      `with ${live ? 'gemini' : 'replay'} (weights ${weights.version})\n`,
  );

  // ── record, if a key is present and anything is missing ──────────────────
  if (gemini) {
    for (const [i, { number, problemIds }] of pendingBatches.entries()) {
      const inputs = problemIds.map((problemId) => ({
        problemId,
        input: factorsInputFor(db, problemId, strategy),
      }));
      const results = await withRetry(`factors batch ${number}`, () =>
        gemini.estimateFactorsBatch(inputs),
      );
      apiCalls++;
      for (const result of results) {
        put({
          key: keyFor(result.problemId),
          stage: 'score',
          output: result.value,
          tokens: result.meta.tokens,
        });
      }
      const missing = problemIds.filter((id) => !results.some((r) => r.problemId === id));
      console.log(
        `  batch ${number} of ${batches.length}: ${results.length}/${problemIds.length} estimate(s)` +
          (missing.length ? `  MISSING: ${missing.join(', ')}` : ''),
      );
      if (i < pendingBatches.length - 1) await sleep(recordRpmGap());
    }
    console.log('');
  }

  // ── score deterministically from whatever is now recorded ────────────────
  // Replay is used even on the live path, so the stored run is keyed to the
  // fixture a keyless reviewer will replay — not to a response only this
  // process saw.
  //
  // Nothing is cleared first: `score_runs` is append-only, so a re-score adds
  // rows and the board reads the newest per problem. An earlier band and the
  // factors behind it stay on the record, which is the point of the table.
  const bands: Record<string, number> = { now: 0, next: 0, later: 0, no: 0 };
  let degraded = 0;

  for (const problemId of ids) {
    currentProblemId = problemId;
    const input = factorsInputFor(db, problemId, strategy);
    const estimate = await logged.estimateFactors(input);
    if (estimate.meta.degraded) {
      degraded++;
      continue; // no estimate, so no run — the board shows it as unscored
    }
    const scored = scoreProblem(estimate.value, weights);
    recordRun(db, {
      problemId,
      factors: estimate.value,
      scored,
      modelId: estimate.meta.modelId,
    });
    bands[scored.band]++;
  }

  console.log(`score_runs written:  ${ids.length - degraded}  (append-only)`);
  console.log(`bands:               now ${bands.now} · next ${bands.next} · later ${bands.later} · no ${bands.no}`);
  console.log(`unscored (degraded): ${degraded}`);
  if (live) console.log(`api calls spent:     ${apiCalls}`);
}

main().catch((err) => {
  if (err instanceof QuotaExhausted) {
    console.error(`\nSTOPPED: ${err.message}`);
    console.error('Recorded estimates are saved; re-running spends quota only on what is left.');
  } else {
    console.error(`score failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
