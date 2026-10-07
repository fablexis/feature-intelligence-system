import { aiConfig } from './config';

/**
 * Recording budget for the remaining core stages.
 *
 * The free tier caps `generate_content` at a small number of requests per day
 * **per model** (20/day measured on one model — see the ADR 0001 amendment), so
 * quota is the scarce resource in this build, not time or money. Three levers:
 *
 *  1. don't call the model when the answer is already known
 *  2. batch where batching cannot corrupt what we measure
 *  3. give each stage its own quota bucket, so one cap stalls one stage
 *
 * Caps below are either MEASURED (an error stated the number), a measured
 * LOWER BOUND (we made N calls without being cut off), or UNKNOWN. Nothing
 * here is guessed from documentation, which does not publish these.
 */
export type CapBasis = 'measured' | 'lower-bound' | 'unknown';

export type BudgetRow = {
  stage: string;
  model: string;
  calls: string;
  cap: string;
  basis: CapBasis;
  note: string;
};

export const SEED_REQUEST_COUNT = 55;
/**
 * Ground-truth problem count in the labelled corpus — the planning figure.
 *
 * The *pipeline* forms more than this (23 at v2, because it over-splits; see
 * eval-results), and factor scoring is billed per formed problem, not per true
 * problem. So `budgetRows` takes the real count as an argument and `npm run
 * score --dry-run` passes what the database actually holds. Leaving 12 as the
 * default would have under-reported the scoring stage by half.
 */
export const PROBLEM_COUNT = 12;
/** Requests whose retrieval returns nothing above the recall floor. */
export const NO_CANDIDATE_SKIPS = PROBLEM_COUNT;
export const FACTOR_BATCH_SIZE = 4;

export function budgetRows(problemCount = PROBLEM_COUNT): BudgetRow[] {
  const cfg = aiConfig();
  const adjudicateCalls = SEED_REQUEST_COUNT + 1 - NO_CANDIDATE_SKIPS; // +1 demo request
  const factorCalls = Math.ceil(problemCount / FACTOR_BATCH_SIZE);

  return [
    {
      stage: 'extract',
      model: cfg.modelFast,
      calls: `${SEED_REQUEST_COUNT + 1} (done)`,
      cap: '≥57/day',
      basis: 'lower-bound',
      note: '57 calls served today without a cut-off',
    },
    {
      stage: 'embed',
      model: cfg.modelEmbed,
      calls: '4 (done)',
      cap: 'separate metric',
      basis: 'unknown',
      note: 'embed_content is not the generate_content bucket',
    },
    {
      stage: 'adjudicate',
      model: cfg.modelAdjudicate,
      calls: `~${adjudicateCalls}`,
      cap: 'unknown',
      basis: 'unknown',
      note: `probe-confirmed available; ${NO_CANDIDATE_SKIPS} skipped by the recall floor`,
    },
    {
      stage: 'factors',
      model: cfg.modelScore,
      calls: `${factorCalls}`,
      cap: '20/day',
      basis: 'measured',
      note:
        `${problemCount} problems batched ${FACTOR_BATCH_SIZE}/call — fits the known cap` +
        (problemCount === PROBLEM_COUNT ? '' : ` (${PROBLEM_COUNT} planned; the pipeline over-splits)`),
    },
  ];
}

export function renderBudget(problemCount = PROBLEM_COUNT): string {
  const rows = budgetRows(problemCount);
  const w = { stage: 11, model: 24, calls: 11, cap: 16 };
  const pad = (s: string, n: number) => s.padEnd(n);
  const line = '─'.repeat(w.stage + w.model + w.calls + w.cap + 4);

  const out = [
    '',
    'RECORDING BUDGET — remaining core stages',
    line,
    `${pad('stage', w.stage)}${pad('model', w.model)}${pad('calls', w.calls)}${pad('daily cap', w.cap)}basis`,
    line,
  ];
  for (const r of rows) {
    out.push(
      `${pad(r.stage, w.stage)}${pad(r.model || '(unset)', w.model)}${pad(r.calls, w.calls)}${pad(r.cap, w.cap)}${r.basis}`,
    );
    out.push(`${' '.repeat(w.stage)}↳ ${r.note}`);
  }
  out.push(line);

  // Verify the isolation claim rather than asserting it. Only generate_content
  // stages share a bucket; embeddings are metered separately.
  const collisions = sharedBuckets();
  if (collisions.length === 0) {
    out.push(
      'Each generate_content stage has its own model, so one exhausted bucket',
      'stalls at most one stage.',
    );
  } else {
    for (const c of collisions) {
      out.push(
        `WARNING: ${c.stages.join(' and ')} both use ${c.model || '(unset)'} — they share`,
        `  one daily cap, so exhausting it stalls both. Set ${c.fix} to split them.`,
      );
    }
  }
  out.push('Progress is checkpointed per call, so a stall resumes for free.', '');
  return out.join('\n');
}

/** generate_content stages that would compete for the same daily cap. */
export function sharedBuckets(): Array<{ model: string; stages: string[]; fix: string }> {
  const cfg = aiConfig();
  const metered: Array<[string, string, string]> = [
    ['extract', cfg.modelFast, 'GEMINI_MODEL_FAST'],
    ['adjudicate', cfg.modelAdjudicate, 'GEMINI_MODEL_ADJUDICATE'],
    ['factors', cfg.modelScore, 'GEMINI_MODEL_SCORE'],
  ];
  const byModel = new Map<string, Array<[string, string]>>();
  for (const [stage, model, envVar] of metered) {
    byModel.set(model, [...(byModel.get(model) ?? []), [stage, envVar]]);
  }
  return [...byModel.entries()]
    .filter(([, stages]) => stages.length > 1)
    .map(([model, stages]) => ({
      model,
      stages: stages.map(([s]) => s),
      fix: stages
        .slice(1)
        .map(([, v]) => v)
        .join(' or '),
    }));
}
