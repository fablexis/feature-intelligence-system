/**
 * C7 — the eval harness. Turns "precision-biased" into a measured claim.
 *
 *   npm run eval                 measure, sweep, rewrite docs/eval-results.md
 *   npm run eval -- --no-write   measure and print; touch no files
 *
 * Three properties this script is built around:
 *
 *  1. **No network, by construction.** `AI_PROVIDER` is forced to `replay` and
 *     `globalThis.fetch` is replaced with a thrower before anything loads a
 *     provider. An eval that could reach an API would be measuring a different
 *     system every time it ran, and would spend quota to do it.
 *  2. **No side effects on the demo database.** The pipeline writes, and
 *     `resetDerived` deletes, so the run happens in a throwaway in-memory
 *     database seeded from `src/seed`. The measurement is reproducible from
 *     source plus fixtures and nothing else.
 *  3. **The sweep replays stage 5, not the pipeline.** Adjudication is recorded
 *     exhaustively, so re-deciding at a different threshold is arithmetic over
 *     recorded tuples (ADR 0002).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { asc } from 'drizzle-orm';
import { loadManifest } from '../src/ai/fixtures';
import { prompt, EMBED_PROMPT_VERSION } from '../src/ai/prompts';
import { createReplayProvider } from '../src/ai/replay';
import { createEvalDb } from '../src/eval/db';
import { V1_RUN } from '../src/eval/history';
import { pairwise } from '../src/eval/pairwise';
import { type ReportData, renderConsole, renderReport, spliceGenerated } from '../src/eval/report';
import {
  type Cell,
  type RecordedRun,
  type Relation,
  type Tuple,
  applySelectionRule,
  attachCounts,
  bindingSignal,
  labelledOverlap,
  pairOutcomes,
  partition,
  stageOneCeiling,
  sweep,
  verdictMix,
} from '../src/eval/sweep';
import { ingestRequest } from '../src/pipeline/ingest';
import { insertCorpus } from '../src/seed/corpus';
import { DISJOINT_PAIRS, PROBLEM_LABELS, RELATED_PAIRS, REQUEST_LABELS } from '../src/seed/labels';
import { requestIdFor } from '../src/seed/requests';
import { dedupeSuggestions, evidenceLinks, requests } from '../src/db/schema';

const RESULTS_DOC = './docs/eval-results.md';
/** 0 is the shipped `T_ask` (formation follows the verdict); the rest is the operating range. */
const GRID = [0, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95] as const;
const CEILING_BREADTHS = [4, 8, 12, 16, 'all'] as const;
/**
 * PRODUCT open question 3: report-only above this, non-zero below it.
 *
 * Overridable by env so the failure path can be exercised without editing the
 * script — the exit code is an acceptance criterion, and a criterion that can
 * only be checked by breaking the build is not checked. The floor in force is
 * printed and written to the results doc, so raising or lowering it is visible
 * rather than silent. E4 will want this hook to gate CI.
 */
const HARD_FLOOR = Number(process.env.EVAL_PRECISION_FLOOR ?? 0.75);

const write = !process.argv.includes('--no-write');

// Before anything can construct a provider.
process.env.AI_PROVIDER = 'replay';
let networkAttempts = 0;
globalThis.fetch = (() => {
  networkAttempts++;
  throw new Error('the eval must not touch the network — it measures recorded fixtures only');
}) as unknown as typeof fetch;

function fail(message: string): never {
  console.error(`\nFAILED: ${message}`);
  process.exit(1);
}

async function main() {
  if (!Number.isFinite(HARD_FLOOR)) fail(`EVAL_PRECISION_FLOOR is not a number`);
  const thresholds = JSON.parse(readFileSync('./config/thresholds.json', 'utf8'));
  const configured = {
    tAsk: 0,
    tAuto: Number(thresholds.tAuto),
    basis: String(thresholds.tAutoBasis ?? '(no basis recorded)'),
  };

  const db = createEvalDb();
  insertCorpus(db);

  const provider = createReplayProvider();
  if (provider.name !== 'replay') fail(`provider is ${provider.name}, not replay`);

  // Same deterministic order the canonical pass used: creation time, then id.
  const corpus = db.select().from(requests).orderBy(asc(requests.createdAt), asc(requests.id)).all();
  if (corpus.length === 0) fail('the seed corpus is empty');

  const degradedStages: Record<string, number> = { extract: 0, embed: 0, retrieve: 0, adjudicate: 0 };
  for (const request of corpus) {
    const result = await ingestRequest(
      db,
      provider,
      { id: request.id, title: request.title, bodyRaw: request.bodyRaw, source: request.source },
      {
        tAuto: configured.tAuto,
        candidateLimit: thresholds.candidateLimit === 'all' ? 'all' : Number(thresholds.candidateLimit),
        minSimilarity: Number(thresholds.minSimilarity ?? 0),
      },
    );
    for (const timing of result.timings) {
      if (timing.degraded) degradedStages[timing.stage] = (degradedStages[timing.stage] ?? 0) + 1;
    }
  }

  // ── the recorded tuples the sweep runs over ────────────────────────────────
  const rows = db
    .select({
      requestId: dedupeSuggestions.requestId,
      problemId: dedupeSuggestions.candidateProblemId,
      similarity: dedupeSuggestions.similarity,
      verdict: dedupeSuggestions.verdict,
      confidence: dedupeSuggestions.verdictConfidence,
    })
    .from(dedupeSuggestions)
    .all();
  const run: RecordedRun = {
    order: corpus.map((r) => r.id),
    tuples: rows.map((r) => ({ ...r, verdict: r.verdict as Relation }) as Tuple),
  };

  // ── integrity: the offline model of stage 5 must equal what the pipeline did ──
  const actual = new Map(
    db
      .select({ requestId: evidenceLinks.requestId, problemId: evidenceLinks.problemId })
      .from(evidenceLinks)
      .all()
      .map((r) => [r.requestId, r.problemId]),
  );
  const reconstructed = partition(run, configured, 'all');
  const mismatches = run.order.filter((id) => actual.get(id) !== reconstructed.get(id));
  if (mismatches.length) {
    fail(
      `the offline sweep disagrees with the pipeline on ${mismatches.length} request(s) ` +
        `(${mismatches.slice(0, 5).join(', ')}) — the sweep's model of stage 5 is wrong, so no number below is trustworthy`,
    );
  }

  // ── labels ────────────────────────────────────────────────────────────────
  const labels = new Map(
    Object.entries(REQUEST_LABELS).map(([slug, label]) => [requestIdFor(slug), label as string]),
  );
  const labelOf = (id: string) => labels.get(id);
  const dbPair = ([a, b]: readonly [string, string]) => [requestIdFor(a), requestIdFor(b)] as const;

  // ── measure ───────────────────────────────────────────────────────────────
  const ids = [...run.order];
  const current = {
    thresholds: configured,
    all: pairwise(ids, (id) => reconstructed.get(id), labelOf),
    auto: pairwise(ids, (id) => partition(run, configured, 'auto').get(id), labelOf),
    counts: attachCounts(run, configured),
  };

  const cells: Cell[] = sweep(run, labelOf, GRID);
  const selection = applySelectionRule(cells);
  const planted = pairOutcomes(reconstructed, DISJOINT_PAIRS.map(dbPair));
  const relatedOutcome = pairOutcomes(
    reconstructed,
    RELATED_PAIRS.map((p) => dbPair([p.a, p.b])),
  );
  const ceiling = stageOneCeiling(run, labelOf, CEILING_BREADTHS, reconstructed);

  const floorMetric = current.auto.precision;
  const floor = {
    metric: floorMetric,
    limit: HARD_FLOOR,
    passed: floorMetric !== null && floorMetric >= HARD_FLOOR,
  };

  const data: ReportData = {
    date: new Date().toISOString().slice(0, 10),
    provider: provider.name,
    apiCalls: 0,
    promptVersions: {
      extract: prompt.extract().version,
      adjudicate: prompt.adjudicate().version,
      embed: EMBED_PROMPT_VERSION,
    },
    fixturesRecordedAt: loadManifest()?.recordedAt ?? null,
    requests: corpus.length,
    labelledProblems: Object.keys(PROBLEM_LABELS).length,
    truePairs: current.all.tp + current.all.fn,
    totalPairs: current.all.pairs,
    degradedStages,
    configured,
    cells,
    selection,
    current,
    planted,
    relatedPairs: {
      merged: relatedOutcome.grouped,
      total: relatedOutcome.total,
      // `missed` here means "stayed distinct", which for these pairs is correct.
      mergedPairs: RELATED_PAIRS.map((p) => dbPair([p.a, p.b]))
        .filter(([a, b]) => reconstructed.get(a) === reconstructed.get(b))
        .map(([a, b]) => `${a}/${b}`),
    },
    ceiling,
    // A problem's true cluster is the cluster of the request that formed it,
    // because problem ids are derived (`prob-<requestId>`).
    overlap: labelledOverlap(run, labelOf, (problemId) =>
      problemId.startsWith('prob-') ? problemId.slice('prob-'.length) : undefined,
    ),
    binding: bindingSignal(run),
    verdictMix: verdictMix(run),
    history: V1_RUN,
    grid: GRID,
    floor,
  };

  console.log(renderConsole(data));

  // ── integrity, before anything is written ─────────────────────────────────
  // These are not metric regressions, they are reasons the run is not a
  // measurement at all — so they must not be allowed to overwrite the last
  // good results doc with numbers describing the fallback path.
  if (networkAttempts > 0) fail(`${networkAttempts} network call(s) attempted`);
  const degradedTotal = Object.values(degradedStages).reduce((a, b) => a + b, 0);
  if (degradedTotal > 0) {
    fail(
      `${degradedTotal} degraded stage(s) — fixtures are stale for the current prompt versions, ` +
        'so this run measured the n-gram fallback rather than the model. ' +
        `${RESULTS_DOC} was left alone`,
    );
  }

  if (write) {
    const doc = readFileSync(RESULTS_DOC, 'utf8');
    writeFileSync(RESULTS_DOC, spliceGenerated(doc, renderReport(data)));
    console.log(`\nwrote ${RESULTS_DOC} (generated region only)`);
  } else {
    console.log('\n--no-write: docs/eval-results.md left alone');
  }

  // ── metric regressions: recorded first, then reported ─────────────────────
  // A below-floor run *is* a measurement, so it is written down and then fails.
  if (!floor.passed) {
    fail(`auto-merge precision ${floor.metric ?? '—'} is below the hard floor of ${HARD_FLOOR}`);
  }
  if (selection.chosen === null) fail('the selection rule found no admissible threshold on the grid');
}

main().catch((err) => {
  console.error(`eval failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
