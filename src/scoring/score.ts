/**
 * The arithmetic half of prioritisation. **No model call happens in this file.**
 *
 * That split is the design: the model does the judgement it is good at —
 * reading prose and turning it into defensible numbers with citations — and
 * deterministic code does the multiplication, because a weighted sum is not a
 * thing to ask a language model for. It also means the same factors always
 * produce the same band, and changing a weight re-bands every problem instantly
 * from stored factors with nothing to re-record.
 *
 * Output is a **band**, never a bare decimal. PRODUCT challenge #4: a reviewer
 * shown a confident 7.4 rubber-stamps it, and 7.4 against 7.1 is noise dressed
 * as rigor. The raw score exists so the ordering inside a band is stable, not
 * so it can be displayed as a result.
 */
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Factors } from '../ai/schemas';

export const BANDS = ['now', 'next', 'later', 'no'] as const;
export type Band = (typeof BANDS)[number];

/** The four factors, in display order. Keys match `FactorsSchema`. */
export const FACTOR_KEYS = ['customerValue', 'strategicFit', 'evidenceStrength', 'effort'] as const;
export type FactorKey = (typeof FACTOR_KEYS)[number];

export const WeightsSchema = z.object({
  version: z.string().min(1),
  weights: z.object({
    customerValue: z.number().min(0).max(1),
    strategicFit: z.number().min(0).max(1),
    evidenceStrength: z.number().min(0).max(1),
    effort: z.number().min(0).max(1),
  }),
  /** Lower bound of each band. Anything below `later` is `no`. */
  bands: z.object({
    now: z.number().min(0).max(1),
    next: z.number().min(0).max(1),
    later: z.number().min(0).max(1),
  }),
});

export type Weights = z.infer<typeof WeightsSchema>;

export const WEIGHTS_PATH = './config/weights.json';

/**
 * Loads and validates the PM-owned weights.
 *
 * Two invariants are enforced rather than documented, because both are silent
 * failures otherwise: the weights must sum to 1 (or the raw score is no longer
 * on a 0–1 scale and the band cut points stop meaning anything), and the band
 * cut points must descend (or a problem could qualify for two bands and the
 * answer would depend on evaluation order).
 */
export function loadWeights(path = WEIGHTS_PATH): Weights {
  const parsed = WeightsSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
  const sum = Object.values(parsed.weights).reduce((a, b) => a + b, 0);
  // Tolerance for decimal representation, not for sloppy config.
  if (Math.abs(sum - 1) > 1e-9) {
    throw new Error(`${path}: weights must sum to 1, got ${sum}`);
  }
  const { now, next, later } = parsed.bands;
  if (!(now > next && next > later)) {
    throw new Error(`${path}: band cut points must descend, got now=${now} next=${next} later=${later}`);
  }
  return parsed;
}

/** The weighted sum, on the same 0–1 scale as the factors. */
export function rawScore(factors: Factors, weights: Weights['weights']): number {
  return FACTOR_KEYS.reduce((total, key) => total + weights[key] * factors[key].score, 0);
}

/**
 * Raw score → band. Inclusive lower bounds, checked in descending order, so a
 * score exactly on a cut point lands in the higher band.
 */
export function bandFor(raw: number, bands: Weights['bands']): Band {
  if (raw >= bands.now) return 'now';
  if (raw >= bands.next) return 'next';
  if (raw >= bands.later) return 'later';
  return 'no';
}

export type Scored = {
  raw: number;
  band: Band;
  weightsVersion: string;
  /** Per-factor contribution to the total, for the decomposition display. */
  contributions: Array<{ key: FactorKey; score: number; weight: number; contribution: number }>;
};

/**
 * The whole deterministic step, in one call.
 *
 * `contributions` is returned rather than recomputed in the view because the
 * point of the decomposition is that it adds up to the number above it. If the
 * view did its own arithmetic, the two could drift and the explanation would
 * stop being an explanation.
 */
export function scoreProblem(factors: Factors, weights: Weights): Scored {
  const raw = rawScore(factors, weights.weights);
  return {
    raw,
    band: bandFor(raw, weights.bands),
    weightsVersion: weights.version,
    contributions: FACTOR_KEYS.map((key) => ({
      key,
      score: factors[key].score,
      weight: weights.weights[key],
      contribution: weights.weights[key] * factors[key].score,
    })),
  };
}

/** Sort order for the board: band first, then raw score, then id for stability. */
export const BAND_RANK: Record<Band, number> = { now: 0, next: 1, later: 2, no: 3 };

export const FACTOR_LABELS: Record<FactorKey, string> = {
  customerValue: 'Customer value',
  strategicFit: 'Strategic fit',
  evidenceStrength: 'Evidence strength',
  effort: 'Effort (1 = cheap)',
};
