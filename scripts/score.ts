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
/**
 * Record exactly the first pending batch, with **no retry**, then stop.
 *
 * A probe exists because retrying is what makes an overloaded model expensive:
 * a 503 still consumes a `generate_content` request, so four backoff attempts
 * spend four of a twenty-call day on nothing (second ADR 0001 amendment). One
 * attempt answers "is this bucket usable right now?" for the price of one call.
 */
const probe = process.argv.includes('--probe');
/**
 * Comma-separated problem ids to record first, ahead of the default sorted
 * order.
 *
 * Recording order is otherwise sorted problem id, which is reproducible but
 * arbitrary with respect to what matters. When quota is the binding constraint,
 * the problems a reviewer will actually look at should be recorded before the
 * budget runs out. Passing them on the command line rather than hardcoding
 * them keeps the default deterministic and leaves the reordering auditable in
 * the shell history — and the dry run prints the resulting composition, so the
 * same flag reproduces the same batches.
 */
const firstArg = process.argv.find((a) => a.startsWith('--first='))?.split('=')[1];
const cfg = aiConfig();
const db = createDb();
const weights = loadWeights();
const strategy = loadStrategy();

/**
 * Batch composition is fixed by a deterministic recording order — `--first`
 * ids if given, then sorted problem id — so the same four problems always
 * travel together and a re-run with the same arguments reproduces the same
 * calls. Fixtures are keyed per problem, so a 24th problem adds one batch
 * rather than invalidating the other 23.
 */
const sorted = db
  .select({ id: problems.id })
  .from(problems)
  .orderBy(asc(problems.id))
  .all()
  .map((p) => p.id);

if (sorted.length === 0) {
  console.error('no problems to score — run `npm run seed` then `npm run ingest` first');
  process.exit(1);
}

const pinned = (firstArg?.split(',') ?? []).map((s) => s.trim()).filter(Boolean);
const unknown = pinned.filter((id) => !sorted.includes(id));
if (unknown.length) {
  console.error(`--first names problems that do not exist: ${unknown.join(', ')}`);
  process.exit(1);
}
const ids = [...pinned, ...sorted.filter((id) => !pinned.includes(id))];

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
  console.log(
    `batch size:          ${FACTOR_BATCH_SIZE}  (composition fixed by ${pinned.length ? '--first, then sorted problem id' : 'sorted problem id'})`,
  );
  console.log(`batches total:       ${batches.length}`);
  console.log(`already recorded:    ${alreadyRecorded.length} problem(s) — a re-run skips their batch`);
  console.log(`API CALLS TO SPEND:  ${probe ? 1 : pendingBatches.length}${probe ? '  (--probe: first pending batch only, no retry)' : ''}`);
  if (pinned.length) console.log(`recorded first:      ${pinned.join(', ')}`);
  console.log(`model:               ${cfg.modelScore || '(unset)'}`);
  console.log(`prompt version:      ${scorePrompt.version}`);
  console.log(`weights:             ${weights.version}  (arithmetic is local — no model call)`);
  console.log(`api key present:     ${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'yes' : 'no'}`);
  console.log(`\n~${Math.ceil((pendingBatches.length * 25 + (pendingBatches.length / cfg.recordRpm) * 60) / 60)}min at ${cfg.recordRpm} rpm`);
  // Only the factors stage still needs quota; extract, embed and adjudicate
  // are fully recorded, so a shared bucket with them cannot stall anything.
  console.log(renderBudget(ids.length, ['factors']));
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
  let currentProblemId: string | undefined;

  console.log(
    `scoring ${ids.length} problem(s) in ${batches.length} batch(es) of ${FACTOR_BATCH_SIZE} ` +
      `with ${live ? 'gemini' : 'replay'} (weights ${weights.version})\n`,
  );

  // ── record, if a key is present and anything is missing ──────────────────
  if (gemini) {
    const todo = probe ? pendingBatches.slice(0, 1) : pendingBatches;
    for (const [i, { number, problemIds }] of todo.entries()) {
      const inputs = problemIds.map((problemId) => ({
        problemId,
        input: factorsInputFor(db, problemId, strategy),
      }));
      // A probe takes one attempt and reports. Retrying is precisely what a
      // probe exists to avoid paying for.
      const attempt = () => gemini.estimateFactorsBatch(inputs);
      const results = probe
        ? await attempt().catch((err: unknown) => {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`\nPROBE FAILED on batch ${number}, after one attempt, with no retry:`);
            console.error(`  ${message}`);
            console.error(
              `\nThe bucket for ${cfg.modelScore} is not usable right now. ` +
                'Nothing was recorded and one call was spent.',
            );
            process.exit(1);
          })
        : await withRetry(`factors batch ${number}`, attempt);
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
      if (i < todo.length - 1) await sleep(recordRpmGap());
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
  //
  // The replay provider is built HERE, after recording, not before: it loads
  // the fixture store once at construction, so one created earlier would be
  // blind to everything this run just wrote and would report every problem as
  // degraded.
  const logged = withDecisionLog(createReplayProvider(), db, () => ({ problemId: currentProblemId }));
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
