/**
 * Records real Gemini outputs over the seed corpus into committed fixtures,
 * so the demo runs offline on genuine model output (ADR 0004).
 *
 * Quota-safe by construction, because the free-tier limits are not published
 * (ADR 0001): throttled, retried with exponential backoff on 429/5xx, and
 * resumable — an input already recorded under its hash is skipped, so a run
 * interrupted at call 150 of 200 does not re-spend the first 150.
 *
 *   npm run record -- --dry-run     count the calls, spend nothing
 *   npm run record                  record
 *
 * Only extraction and embeddings are recordable before C3 exists; see
 * docs/TASKS.md#c2.
 */
import { renderBudget } from '../src/ai/budget';
import { canonicalText } from '../src/ai/canonical';
import { aiConfig, requireGeminiConfig } from '../src/ai/config';
import { type FixtureEntry, loadFixtures, round6, saveFixtures, saveManifest } from '../src/ai/fixtures';
import { createGeminiProvider } from '../src/ai/gemini';
import { fixtureKey } from '../src/ai/hash';
import { EMBED_PROMPT_VERSION, prompt } from '../src/ai/prompts';
import { QuotaExhausted, sleep, withRetry } from '../src/ai/retry';
import { ProblemDraftSchema } from '../src/ai/schemas';
import { DEMO_REQUEST, SEED_REQUESTS } from '../src/seed/requests';

const dryRun = process.argv.includes('--dry-run');
/**
 * Record one stage without touching another's quota bucket.
 *
 * Note which stages live here: `extract` and `embed` are stateless, so they
 * can be enumerated up front. `adjudicate` and `score` depend on pipeline
 * state and are recorded by `npm run ingest` and C5's scorer respectively —
 * see docs/TASKS.md#c2.
 */
const STAGES = ['extract', 'embed'] as const;
const stageArg = process.argv.find((a) => a.startsWith('--stage='))?.split('=')[1];
if (stageArg && !STAGES.includes(stageArg as (typeof STAGES)[number])) {
  console.error(`--stage must be one of: ${STAGES.join(', ')}`);
  console.error('adjudicate is recorded by `npm run ingest`; score by C5.');
  process.exit(1);
}
const wants = (stage: (typeof STAGES)[number]) => !stageArg || stageArg === stage;
const cfg = aiConfig();

type ExtractJob = { title: string; bodyRaw: string; source: ExtractSource; id: string };
type ExtractSource = (typeof SEED_REQUESTS)[number]['source'];

const extractJobs: ExtractJob[] = [
  ...SEED_REQUESTS.map((r) => ({ id: r.id, title: r.title, bodyRaw: r.bodyRaw, source: r.source })),
  { id: 'demo', title: DEMO_REQUEST.title, bodyRaw: DEMO_REQUEST.bodyRaw, source: DEMO_REQUEST.source },
];

const fixtures = loadFixtures();
const extractPrompt = prompt.extract();

const extractKey = (j: ExtractJob) =>
  fixtureKey({
    stage: 'extract',
    modelId: cfg.modelFast,
    promptVersion: extractPrompt.version,
    input: { title: j.title, bodyRaw: j.bodyRaw, source: j.source },
  });

const embedKey = (text: string) =>
  fixtureKey({ stage: 'embed', modelId: cfg.modelEmbed, promptVersion: EMBED_PROMPT_VERSION, input: text });

const pendingExtract = wants('extract')
  ? extractJobs.filter((j) => !fixtures.has(extractKey(j)))
  : [];

/**
 * Every recorded extraction whose canonical text has no embedding yet.
 * Derived from the fixture store so it is correct across resumed runs.
 */
function missingEmbeddings(): Array<{ text: string; key: string }> {
  const out = new Map<string, string>();
  for (const entry of fixtures.values()) {
    if (entry.stage !== 'extract') continue;
    const draft = ProblemDraftSchema.safeParse(entry.output);
    if (!draft.success) continue;
    const text = canonicalText(draft.data);
    const key = embedKey(text);
    if (!fixtures.has(key)) out.set(key, text);
  }
  return [...out.entries()].map(([key, text]) => ({ key, text }));
}

// ─── dry run ────────────────────────────────────────────────────────────────

const embedBatches = (n: number) => Math.ceil(n / cfg.embedBatchSize);

if (dryRun) {
  const recordedExtract = extractJobs.length - pendingExtract.length;
  // Counted from the fixture store, so a resumed run reports the real backlog
  // including extractions recorded by an earlier run that died before embedding.
  const embedTexts = wants('embed') ? missingEmbeddings().length + pendingExtract.length : 0;
  const apiCalls = pendingExtract.length + embedBatches(embedTexts);

  console.log('DRY RUN — no API calls made, no quota spent\n');
  console.log('stage        texts   api calls   note');
  console.log('─────────────────────────────────────────────────────────────────');
  console.log(
    `extract      ${pad(pendingExtract.length)}   ${pad(pendingExtract.length)}       ${SEED_REQUESTS.length} seed + 1 demo request`,
  );
  console.log(
    `embed        ${pad(embedTexts)}   ${pad(embedBatches(embedTexts))}       batched ${cfg.embedBatchSize} per call at ${cfg.embedDim} dims`,
  );
  console.log(`adjudicate   ${pad(0)}   ${pad(0)}       deferred — inputs depend on pipeline state (C3)`);
  console.log(`factors      ${pad(0)}   ${pad(0)}       deferred — needs formed problems (C3, used by C5)`);
  console.log('─────────────────────────────────────────────────────────────────');
  // Throttle gaps are the floor, not the estimate: a structured-output call
  // against the fast tier measured 19-23s, and latency dominates by ~7x.
  const throttleSec = Math.ceil((apiCalls / cfg.recordRpm) * 60);
  const latencySec = apiCalls * 21;
  console.log(
    `TOTAL                ${pad(apiCalls)}       ~${Math.ceil((throttleSec + latencySec) / 60)}min (${latencySec}s latency + ${throttleSec}s throttle)\n`,
  );
  console.log(`already recorded:    ${recordedExtract} extraction(s) — a re-run skips these`);
  console.log(`models:              fast=${cfg.modelFast || '(unset)'}  embed=${cfg.modelEmbed || '(unset)'}`);
  console.log(`prompt version:      extract=${extractPrompt.version}`);
  console.log(`api key present:     ${process.env.GOOGLE_GENERATIVE_AI_API_KEY ? 'yes' : 'no'}`);
  console.log(renderBudget());
  process.exit(0);
}

// ─── record ─────────────────────────────────────────────────────────────────

const minGapMs = Math.ceil(60_000 / Math.max(cfg.recordRpm, 1));

const put = (entry: FixtureEntry) => {
  fixtures.set(entry.key, entry);
  saveFixtures(fixtures); // checkpoint after every call, so a crash loses nothing
};

async function main() {
  requireGeminiConfig();
  const provider = createGeminiProvider();

  console.log(`recording ${pendingExtract.length} extraction(s) at ${cfg.recordRpm} rpm\n`);

  for (const [i, job] of pendingExtract.entries()) {
    const result = await withRetry(`extract ${job.id}`, () =>
      provider.extractProblem({ title: job.title, bodyRaw: job.bodyRaw, source: job.source }),
    );
    put({ key: extractKey(job), stage: 'extract', output: result.value, tokens: result.meta.tokens });
    console.log(`  [${i + 1}/${pendingExtract.length}] extract ${job.id} (${result.meta.latencyMs}ms)`);
    if (i < pendingExtract.length - 1) await sleep(minGapMs);
  }

  // Embed work is derived from the WHOLE fixture store, not from this run's
  // extractions. Deriving it from the run under-records on resume: a run that
  // dies before the embed phase leaves its extractions permanently unembedded.
  const statements = wants('embed') ? missingEmbeddings() : [];

  console.log(`\nembedding ${statements.length} statement(s) in ${embedBatches(statements.length)} batch(es)\n`);

  for (let i = 0; i < statements.length; i += cfg.embedBatchSize) {
    const batch = statements.slice(i, i + cfg.embedBatchSize);
    const n = Math.floor(i / cfg.embedBatchSize) + 1;
    const results = await withRetry(`embed batch ${n}`, () =>
      provider.embedBatch(batch.map((s) => s.text)),
    );
    results.forEach((r, j) => {
      put({
        key: batch[j].key,
        stage: 'embed',
        output: Array.from(r.value.vector, round6),
        tokens: r.meta.tokens,
      });
    });
    console.log(`  batch ${n}: ${batch.length} vector(s) at ${results[0]?.value.vector.length} dims`);
    if (i + cfg.embedBatchSize < statements.length) await sleep(minGapMs);
  }

  const counts = [...fixtures.values()].reduce<Record<string, number>>((acc, e) => {
    acc[e.stage] = (acc[e.stage] ?? 0) + 1;
    return acc;
  }, {});

  saveManifest({
    recordedAt: new Date().toISOString(),
    models: { fast: cfg.modelFast, strong: cfg.modelStrong, embed: cfg.modelEmbed },
    embedDim: cfg.embedDim,
    promptVersions: {
      extract: extractPrompt.version,
      adjudicate: prompt.adjudicate().version,
      factors: prompt.factors().version,
      embed: EMBED_PROMPT_VERSION,
    },
    counts,
    pending: {
      adjudicate: 'inputs depend on which problems exist when each request arrives — record after C3',
      score: 'needs formed problems and their evidence sets — record after C3, used by C5',
    },
  });

  console.log(`\ndone. fixtures: ${JSON.stringify(counts)}`);
}

main().catch((err) => {
  // Message only — an SDK error object can carry request details.
  const recorded = loadFixtures().size;
  if (err instanceof QuotaExhausted) {
    console.error(`\nSTOPPED: ${err.message}`);
    console.error(`${recorded} fixture(s) are saved and will be skipped on the next run.`);
  } else {
    console.error(`record failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});

function pad(n: number) {
  return String(n).padStart(5);
}
