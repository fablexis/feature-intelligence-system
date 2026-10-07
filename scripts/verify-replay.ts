/**
 * Proves the keyless path actually works: every seeded request and the scripted
 * demo request must resolve to a REAL recorded output, not the n-gram fallback.
 *
 * This is the check that would have caught the original synthetic-mock design
 * (ADR 0004): it fails loudly if the demo would silently degrade.
 *
 *   npm run verify:replay
 */
import { canonicalText } from '../src/ai/canonical';
import { aiConfig } from '../src/ai/config';
import { loadManifest } from '../src/ai/fixtures';
import { createReplayProvider } from '../src/ai/replay';
import { DEMO_REQUEST, SEED_REQUESTS } from '../src/seed/requests';

async function main() {
  // Replay must be exercised regardless of what AI_PROVIDER is set to.
  process.env.AI_PROVIDER = 'replay';
  const provider = createReplayProvider();
  const cfg = aiConfig();
  const manifest = loadManifest();

  const jobs = [
    ...SEED_REQUESTS.map((r) => ({ id: r.id, title: r.title, bodyRaw: r.bodyRaw, source: r.source })),
    { id: 'DEMO', title: DEMO_REQUEST.title, bodyRaw: DEMO_REQUEST.bodyRaw, source: DEMO_REQUEST.source },
  ];

  const degradedExtract: string[] = [];
  const degradedEmbed: string[] = [];
  let dims = 0;

  for (const job of jobs) {
    // Only the three fields the provider's input hash is built from — passing
    // the fixture's `id` as well would change the key and miss every fixture.
    const extract = await provider.extractProblem({
      title: job.title,
      bodyRaw: job.bodyRaw,
      source: job.source,
    });
    if (extract.meta.degraded) degradedExtract.push(job.id);

    const embed = await provider.embed({ text: canonicalText(extract.value) });
    if (embed.meta.degraded || embed.value.space !== 'gemini') degradedEmbed.push(job.id);
    dims = embed.value.vector.length;
  }

  // Determinism: the same input must give a byte-identical answer.
  const first = await provider.extractProblem(jobs[0]);
  const second = await provider.extractProblem(jobs[0]);
  const deterministic = JSON.stringify(first.value) === JSON.stringify(second.value);

  console.log(`provider:          replay (AI_PROVIDER forced, no network)`);
  console.log(`fixtures recorded: ${manifest?.recordedAt ?? 'no manifest'}`);
  // Both lines, deliberately. A fixture key includes the model id, so these
  // two must agree or every lookup misses — and printing only the *recorded*
  // side is what let a fresh clone with no `.env` report the right models
  // while degrading all 56 inputs (C8).
  console.log(`models in use:     fast=${cfg.modelFast || '(unset)'} embed=${cfg.modelEmbed || '(unset)'}  ← from ${cfg.modelSource === 'env' ? 'env / .env' : cfg.modelSource === 'template' ? '.env.example defaults' : 'NOTHING'}`);
  console.log(`models recorded:   fast=${manifest?.models.fast} embed=${manifest?.models.embed}`);
  console.log(`inputs checked:    ${jobs.length} (${SEED_REQUESTS.length} seed + 1 demo)`);
  console.log(`embedding dim:     ${dims} (configured ${cfg.embedDim})`);
  console.log(`deterministic:     ${deterministic ? 'yes' : 'NO'}`);
  console.log(`real extractions:  ${jobs.length - degradedExtract.length}/${jobs.length}`);
  console.log(`real embeddings:   ${jobs.length - degradedEmbed.length}/${jobs.length}`);

  const problems = [
    degradedExtract.length && `degraded extractions: ${degradedExtract.join(', ')}`,
    degradedEmbed.length && `degraded embeddings: ${degradedEmbed.join(', ')}`,
    !deterministic && 'replay is not deterministic',
    dims !== cfg.embedDim && `embedding dim ${dims} != configured ${cfg.embedDim}`,
  ].filter(Boolean);

  if (problems.length) {
    console.error(`\nFAILED:\n  ${problems.join('\n  ')}`);
    process.exit(1);
  }
  console.log('\nOK — the keyless path serves real model output for the whole corpus.');
}

main().catch((err) => {
  console.error(`verify failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
