/**
 * Previous published runs, so the harness can render the v1 → v2 history
 * instead of asking a reader to scroll and diff two sections by eye.
 *
 * **Provenance:** these are the numbers published in `docs/eval-results.md` on
 * 2026-10-07 for adjudication prompt `v1-b492db6f`. They are **quoted, not
 * recomputed.** The v1 fixtures are still on disk, but a fixture key includes
 * the prompt's content hash, so reproducing them means reverting
 * `prompts/adjudicate.md` — which is a deliberate choice this harness does not
 * make for you.
 *
 * One figure is deliberately absent. v1's published auto-band recall (0.233)
 * was computed as `tp_auto / (tp_auto + fn_all-band)`, mixing a numerator from
 * one band with a denominator from another. The harness scores every band on
 * the same 116 true pairs, so that number is not comparable and is not quoted.
 */
export type PublishedRun = {
  label: string;
  adjudicationPrompt: string;
  /** All-band pairwise figures, which the harness computes identically. */
  precision: number;
  recall: number;
  tp: number;
  fp: number;
  fn: number;
  problems: number;
  plantedPairsCaught: number;
  relatedPairsMerged: number;
};

export const V1_RUN: PublishedRun = {
  label: 'v1',
  adjudicationPrompt: 'v1-b492db6f',
  precision: 0.974,
  recall: 0.319,
  tp: 37,
  fp: 1,
  fn: 79,
  problems: 31,
  plantedPairsCaught: 6,
  relatedPairsMerged: 1,
};
