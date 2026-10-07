import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { Factors } from '../ai/schemas';
import {
  BANDS,
  FACTOR_KEYS,
  bandFor,
  loadWeights,
  rawScore,
  scoreProblem,
  WEIGHTS_PATH,
} from './score';

const factor = (score: number) => ({ score, citations: ['ev-1'], reason: 'r' });
const factors = (
  customerValue: number,
  strategicFit: number,
  evidenceStrength: number,
  effort: number,
): Factors => ({
  customerValue: factor(customerValue),
  strategicFit: factor(strategicFit),
  evidenceStrength: factor(evidenceStrength),
  effort: factor(effort),
  confidence: 0.7,
  tension: '',
});

const W = loadWeights();

describe('the shipped weights file', () => {
  it('sums to 1, so the raw score stays on the band scale', () => {
    const sum = Object.values(W.weights).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  it('gives customer value and strategic fit the majority, per PRODUCT D2', () => {
    expect(W.weights.customerValue + W.weights.strategicFit).toBeGreaterThan(0.5);
  });

  it('keeps evidence strength a minority weight — the point of the rebuild', () => {
    // Breadth was already the dominant quantified field in the spreadsheet
    // this replaces. If it dominates here too, nothing has changed.
    expect(W.weights.evidenceStrength).toBeLessThan(W.weights.customerValue);
    expect(W.weights.evidenceStrength).toBeLessThan(W.weights.strategicFit);
  });

  it('gives the least weight to the factor the model is worst at', () => {
    expect(W.weights.effort).toBe(Math.min(...Object.values(W.weights)));
  });

  it('is the file the UI claims to show', () => {
    expect(WEIGHTS_PATH).toBe('./config/weights.json');
  });
});

describe('loadWeights rejects configs that would fail silently', () => {
  const write = (body: unknown) => {
    const path = join(tmpdir(), `weights-${Math.random().toString(36).slice(2)}.json`);
    writeFileSync(path, JSON.stringify(body));
    return path;
  };

  it('refuses weights that do not sum to 1', () => {
    const path = write({
      version: 'x',
      weights: { customerValue: 0.5, strategicFit: 0.5, evidenceStrength: 0.5, effort: 0.5 },
      bands: { now: 0.7, next: 0.5, later: 0.3 },
    });
    expect(() => loadWeights(path)).toThrow(/must sum to 1/);
  });

  it('refuses band cut points that do not descend', () => {
    const path = write({
      version: 'x',
      weights: { customerValue: 0.25, strategicFit: 0.25, evidenceStrength: 0.25, effort: 0.25 },
      bands: { now: 0.3, next: 0.5, later: 0.7 },
    });
    expect(() => loadWeights(path)).toThrow(/must descend/);
  });

  it('refuses a factor weight outside 0–1', () => {
    const path = write({
      version: 'x',
      weights: { customerValue: 2, strategicFit: -1, evidenceStrength: 0, effort: 0 },
      bands: { now: 0.7, next: 0.5, later: 0.3 },
    });
    expect(() => loadWeights(path)).toThrow();
  });
});

describe('rawScore', () => {
  it('is the weighted sum of the four factors', () => {
    const f = factors(1, 0, 0, 0);
    expect(rawScore(f, W.weights)).toBeCloseTo(W.weights.customerValue);
  });

  it('is 1 when every factor is 1 and 0 when every factor is 0', () => {
    expect(rawScore(factors(1, 1, 1, 1), W.weights)).toBeCloseTo(1);
    expect(rawScore(factors(0, 0, 0, 0), W.weights)).toBe(0);
  });

  it('lets value and fit outrank breadth — the demo\'s central contrast', () => {
    // Narrow but strategic: few accounts, high ARR, hits a goal.
    const strategic = factors(0.9, 0.9, 0.3, 0.5);
    // Popular but not strategic: many accounts, low ARR, no goal.
    const popular = factors(0.2, 0.1, 1.0, 0.8);
    expect(rawScore(strategic, W.weights)).toBeGreaterThan(rawScore(popular, W.weights));
  });
});

describe('bandFor', () => {
  it('maps a score into exactly one of four bands', () => {
    for (const raw of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      expect(BANDS).toContain(bandFor(raw, W.bands));
    }
  });

  it('puts a score exactly on a cut point in the higher band', () => {
    expect(bandFor(W.bands.now, W.bands)).toBe('now');
    expect(bandFor(W.bands.next, W.bands)).toBe('next');
    expect(bandFor(W.bands.later, W.bands)).toBe('later');
  });

  it('is monotonic — a higher score never lands in a worse band', () => {
    const rank = { now: 0, next: 1, later: 2, no: 3 };
    let previous = 3;
    for (const raw of [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]) {
      const current = rank[bandFor(raw, W.bands)];
      expect(current).toBeLessThanOrEqual(previous);
      previous = current;
    }
  });

  it('calls anything below the later cut point "no"', () => {
    expect(bandFor(W.bands.later - 0.0001, W.bands)).toBe('no');
    expect(bandFor(0, W.bands)).toBe('no');
  });
});

describe('scoreProblem is deterministic — same factors in, same band out', () => {
  it('returns an identical result on repeated calls', () => {
    const f = factors(0.8, 0.7, 0.4, 0.5);
    expect(scoreProblem(f, W)).toEqual(scoreProblem(f, W));
  });

  it('decomposes into contributions that sum to the raw score', () => {
    const scored = scoreProblem(factors(0.8, 0.7, 0.4, 0.5), W);
    const summed = scored.contributions.reduce((a, c) => a + c.contribution, 0);
    // The displayed decomposition has to add up to the number above it, or it
    // is not an explanation.
    expect(summed).toBeCloseTo(scored.raw, 10);
    expect(scored.contributions.map((c) => c.key)).toEqual([...FACTOR_KEYS]);
  });

  it('carries the weights version, so a stale run is identifiable', () => {
    expect(scoreProblem(factors(0.5, 0.5, 0.5, 0.5), W).weightsVersion).toBe(W.version);
  });

  it('re-bands from stored factors when the weights change, with no model call', () => {
    // This is what makes the weights a real PM-owned lever rather than a label.
    const f = factors(0.2, 0.1, 1.0, 0.8);
    const breadthWins = {
      ...W,
      version: 'breadth-heavy',
      weights: { customerValue: 0.1, strategicFit: 0.1, evidenceStrength: 0.7, effort: 0.1 },
    };
    expect(scoreProblem(f, W).raw).toBeLessThan(scoreProblem(f, breadthWins).raw);
  });
});
