/**
 * Records the scripted demo request's adjudication against the formed problem
 * set, **without mutating the database**.
 *
 * Why this exists: the demo request is typed live by a reviewer, so it is not
 * part of the seeded corpus and `ingest` never touches it. Without this, the
 * one moment the whole demo rests on would fall back to n-grams and fail.
 *
 * Why it can be recorded ahead of time: an adjudication fixture is keyed on
 * `(draft, candidates)` and not on the request id, so the verdict recorded here
 * is the same verdict a live submission of the same text will find.
 *
 *   npm run record:demo -- --dry-run
 *   npm run record:demo
 */
import { readFileSync } from 'node:fs';
import { canonicalText } from '../src/ai/canonical';
import { aiConfig } from '../src/ai/config';
import { createRecordingProvider } from '../src/ai/recording';
import { createReplayProvider } from '../src/ai/replay';
import { QuotaExhausted } from '../src/ai/retry';
import { createDb } from '../src/db/index';
import { retrieveCandidates } from '../src/pipeline/retrieval';
import { resolve } from '../src/pipeline/resolve';
import { DEMO_REQUEST } from '../src/seed/requests';

const dryRun = process.argv.includes('--dry-run');
const cfg = aiConfig();
const thresholds = JSON.parse(readFileSync('./config/thresholds.json', 'utf8'));

async function main() {
  const db = createDb();
  const live = cfg.provider === 'gemini' && !dryRun;
  const provider = live ? createRecordingProvider() : createReplayProvider();

  const extracted = await provider.extractProblem({
    title: DEMO_REQUEST.title,
    bodyRaw: DEMO_REQUEST.bodyRaw,
    source: DEMO_REQUEST.source,
  });
  const embedded = await provider.embed({ text: canonicalText(extracted.value) });
  const retrieval = retrieveCandidates(db, embedded.value.vector, embedded.value.space, {
    limit: thresholds.candidateLimit === 'all' ? 'all' : Number(thresholds.candidateLimit),
    minSimilarity: Number(thresholds.minSimilarity ?? 0),
  });

  console.log(`demo request: "${DEMO_REQUEST.title}"`);
  console.log(`extracted:    ${extracted.value.statement}`);
  console.log(`              (confidence ${extracted.value.confidence}, degraded ${extracted.meta.degraded})`);
  console.log(`candidates:   ${retrieval.candidates.length} problems`);

  if (dryRun) {
    console.log(`\nDRY RUN — 1 adjudication call would be made against ${retrieval.candidates.length} candidates`);
    return;
  }

  const judged = await provider.adjudicate({ draft: extracted.value, candidates: retrieval.candidates });
  const resolution = resolve(judged.value, retrieval.candidates, Number(thresholds.tAuto));

  const top = [...judged.value]
    .filter((v) => v.relation !== 'distinct')
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  console.log(`\nverdicts:     ${judged.value.filter((v) => v.relation === 'same').length} same, ${judged.value.filter((v) => v.relation === 'related').length} related, ${judged.value.filter((v) => v.relation === 'distinct').length} distinct`);
  console.log(`degraded:     ${judged.meta.degraded}`);
  for (const v of top) {
    const sim = retrieval.candidates.find((c) => c.problemId === v.problemId)?.similarity ?? 0;
    console.log(`  ${v.relation.padEnd(8)} ${v.problemId}  conf ${v.confidence.toFixed(2)}  sim ${sim.toFixed(3)}`);
    console.log(`           ↳ ${v.rationale}`);
  }

  if (resolution.kind === 'attach') {
    const problem = retrieval.candidates.find((c) => c.problemId === resolution.problemId);
    console.log(`\nRESOLVES TO:  ${resolution.problemId} (${resolution.auto ? 'auto-attach' : 'flagged for confirmation'})`);
    console.log(`score:        ${resolution.score.toFixed(3)} vs T_auto ${thresholds.tAuto}`);
    console.log(`problem:      ${problem?.statement}`);
  } else {
    console.log('\nRESOLVES TO:  a NEW problem — the demo request did not match anything');
  }
}

main().catch((err) => {
  if (err instanceof QuotaExhausted) {
    console.error(`\nSTOPPED: ${err.message}`);
  } else {
    console.error(`record:demo failed: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exit(1);
});
