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
      ...scoreCap(),
      calls: `${factorCalls}`,
      note:
        `${problemCount} problems batched ${FACTOR_BATCH_SIZE}/call` +
        (problemCount === PROBLEM_COUNT ? '' : ` (${PROBLEM_COUNT} planned; the pipeline over-splits)`),
    },
  ];
}

/**
 * The scoring stage's cap follows **the model it is pointed at**, not the
 * stage — which is the whole reason this is computed rather than written down.
 * The 20/day figure was measured on the strong tier; after 503s burned that
 * bucket, scoring moved to the fast tier, whose capacity is a different and
 * better-evidenced number. A row that kept claiming "20/day measured" would be
 * reporting a fact about a model no longer in use.
 *
 * Compared by tier rather than by model id, because no model id may appear in
 * `src/` — identity comes from the environment (ADR 0001).
 */
function scoreCap(): { cap: string; basis: CapBasis } {
  const cfg = aiConfig();
  if (cfg.modelScore && cfg.modelScore === cfg.modelFast) {
    return { cap: '≥57/day', basis: 'lower-bound' };
  }
  if (cfg.modelScore && cfg.modelScore === cfg.modelStrong) {
    return { cap: '20/day', basis: 'measured' };
  }
  return { cap: 'unknown', basis: 'unknown' };
}

export function renderBudget(
  problemCount = PROBLEM_COUNT,
  active: readonly MeteredStage[] = METERED_STAGES,
): string {
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
  const collisions = sharedBuckets(active);
  if (collisions.length === 0) {
    out.push(
      'Each stage that still needs quota has its own model, so one exhausted',
      'bucket stalls at most one stage.',
    );
  } else {
    for (const c of collisions) {
      out.push(
        `WARNING: ${c.stages.join(' and ')} both use ${c.model || '(unset)'} — they share`,
        `  one daily cap, so exhausting it stalls both. Set ${c.fix} to split them.`,
      );
    }
  }
  // Sharing with a finished stage is safe, and saying so is the point: it is
  // the escape hatch when a model's cap is gone for the day.
  for (const o of benignOverlaps(active)) {
    out.push(
      `note: ${o.stage} shares ${o.model || '(unset)'} with ${o.with.join(' and ')}, which is`,
      `  already fully recorded — a finished stage makes no calls, so the shared`,
      `  bucket cannot stall either one.`,
    );
  }
  out.push('Progress is checkpointed per call, so a stall resumes for free.', '');
  return out.join('\n');
}

/** The `generate_content` stages that can consume a daily cap. */
export const METERED_STAGES = ['extract', 'adjudicate', 'factors'] as const;
export type MeteredStage = (typeof METERED_STAGES)[number];

/**
 * generate_content stages that would compete for the same daily cap.
 *
 * **Only stages that still need quota can collide.** A shared bucket is a risk
 * because exhausting it stalls two stages at once — but a stage whose fixtures
 * are already fully recorded will not ask for another call, so it cannot be
 * stalled and cannot stall anything else. Treating a finished stage as a
 * collision would have blocked the only move available when the strong tier's
 * cap was burned by 503s: moving scoring onto the already-complete extract
 * bucket (third ADR 0001 amendment).
 *
 * @param active stages that still have calls to make; default all of them
 */
export function sharedBuckets(
  active: readonly MeteredStage[] = METERED_STAGES,
): Array<{ model: string; stages: string[]; fix: string }> {
  const cfg = aiConfig();
  const metered: Array<[MeteredStage, string, string]> = [
    ['extract', cfg.modelFast, 'GEMINI_MODEL_FAST'],
    ['adjudicate', cfg.modelAdjudicate, 'GEMINI_MODEL_ADJUDICATE'],
    ['factors', cfg.modelScore, 'GEMINI_MODEL_SCORE'],
  ];
  const byModel = new Map<string, Array<[string, string]>>();
  for (const [stage, model, envVar] of metered) {
    if (!active.includes(stage)) continue;
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

/** Stages sharing a model with a stage that is already finished. */
export function benignOverlaps(
  active: readonly MeteredStage[],
): Array<{ model: string; stage: MeteredStage; with: MeteredStage[] }> {
  const cfg = aiConfig();
  const modelOf: Record<MeteredStage, string> = {
    extract: cfg.modelFast,
    adjudicate: cfg.modelAdjudicate,
    factors: cfg.modelScore,
  };
  const finished = METERED_STAGES.filter((s) => !active.includes(s));
  return active
    .map((stage) => ({
      model: modelOf[stage],
      stage,
      with: finished.filter((f) => modelOf[f] === modelOf[stage]),
    }))
    .filter((row) => row.with.length > 0);
}
