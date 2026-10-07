import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { METERED_STAGES, benignOverlaps, budgetRows, renderBudget, sharedBuckets } from './budget';

/**
 * The budget's job is to be *checked*, not asserted — `renderBudget` verifies
 * the quota-isolation claim rather than printing it. These tests cover the rule
 * that let scoring move buckets when the strong tier's cap was gone: a shared
 * model only matters if both stages still need quota.
 */
const ENV_KEYS = [
  'GEMINI_MODEL_FAST',
  'GEMINI_MODEL_STRONG',
  'GEMINI_MODEL_ADJUDICATE',
  'GEMINI_MODEL_SCORE',
] as const;

let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

/** Stand-in tier names. Never real model ids — those live only in the env. */
const setModels = (fast: string, strong: string, adjudicate: string, score: string) => {
  process.env.GEMINI_MODEL_FAST = fast;
  process.env.GEMINI_MODEL_STRONG = strong;
  process.env.GEMINI_MODEL_ADJUDICATE = adjudicate;
  process.env.GEMINI_MODEL_SCORE = score;
};

describe('shared quota buckets', () => {
  it('reports no collision when every stage has its own model', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-score');
    expect(sharedBuckets()).toEqual([]);
  });

  it('flags two stages that would compete for one daily cap', () => {
    setModels('m-fast', 'm-strong', 'm-shared', 'm-shared');
    const collisions = sharedBuckets();
    expect(collisions).toHaveLength(1);
    expect(collisions[0].stages.sort()).toEqual(['adjudicate', 'factors']);
    expect(collisions[0].fix).toContain('GEMINI_MODEL_SCORE');
  });

  it('does NOT flag a collision with a stage that is already finished', () => {
    // The move that unblocked C5: scoring onto the completed extract bucket.
    setModels('m-shared', 'm-strong', 'm-adj', 'm-shared');
    expect(sharedBuckets()).toHaveLength(1); // …when both are considered active
    expect(sharedBuckets(['factors'])).toEqual([]); // …but extraction is done
  });

  it('names the finished stage it is sharing with, so the reason is visible', () => {
    setModels('m-shared', 'm-strong', 'm-adj', 'm-shared');
    const overlaps = benignOverlaps(['factors']);
    expect(overlaps).toHaveLength(1);
    expect(overlaps[0]).toMatchObject({ stage: 'factors', model: 'm-shared' });
    expect(overlaps[0].with).toEqual(['extract']);
  });

  it('reports nothing benign when the shared stage is still active', () => {
    setModels('m-shared', 'm-strong', 'm-adj', 'm-shared');
    expect(benignOverlaps(METERED_STAGES)).toEqual([]);
  });

  it('becomes a real collision again if the finished stage needs quota once more', () => {
    // Editing the extract prompt invalidates its fixtures, so it needs calls.
    setModels('m-shared', 'm-strong', 'm-adj', 'm-shared');
    expect(sharedBuckets(['extract', 'factors'])).toHaveLength(1);
  });
});

describe("the factors row's cap follows its model, not the stage", () => {
  const factorsRow = (problemCount = 23) => budgetRows(problemCount).find((r) => r.stage === 'factors')!;

  it('inherits the fast tier’s measured lower bound when pointed there', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-fast');
    expect(factorsRow()).toMatchObject({ cap: '≥57/day', basis: 'lower-bound' });
  });

  it('inherits the strong tier’s measured cap when pointed there', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-strong');
    expect(factorsRow()).toMatchObject({ cap: '20/day', basis: 'measured' });
  });

  it('says unknown rather than guessing for an unrecognised tier', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-other');
    expect(factorsRow()).toMatchObject({ cap: 'unknown', basis: 'unknown' });
  });
});

describe('call counts are computed from the real problem count', () => {
  it('bills per formed problem, not per ground-truth problem', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-score');
    // 23 formed problems at 4 per call is 6, not the 3 that 12 would imply.
    expect(budgetRows(23).find((r) => r.stage === 'factors')?.calls).toBe('6');
    expect(budgetRows(12).find((r) => r.stage === 'factors')?.calls).toBe('3');
  });

  it('says so in the note when the two disagree', () => {
    setModels('m-fast', 'm-strong', 'm-adj', 'm-score');
    expect(budgetRows(23).find((r) => r.stage === 'factors')?.note).toContain('over-splits');
    expect(budgetRows(12).find((r) => r.stage === 'factors')?.note).not.toContain('over-splits');
  });
});

describe('renderBudget', () => {
  it('verifies the isolation claim instead of printing it', () => {
    setModels('m-fast', 'm-strong', 'm-shared', 'm-shared');
    expect(renderBudget(23)).toContain('WARNING');
  });

  it('explains a benign overlap rather than warning about it', () => {
    setModels('m-shared', 'm-strong', 'm-adj', 'm-shared');
    const out = renderBudget(23, ['factors']);
    expect(out).not.toContain('WARNING');
    expect(out).toContain('already fully recorded');
  });
});
