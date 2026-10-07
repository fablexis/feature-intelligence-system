/**
 * Pairwise scoring — the only sound way to compare the pipeline's problems
 * against the labels.
 *
 * The labels are opaque keys and the pipeline mints its own problem ids
 * (`src/seed/labels.ts`), so the two partitions cannot be matched id-to-id.
 * What *is* comparable is the grouping relation: for every pair of requests,
 * did the pipeline put them together, and should it have?
 *
 * That makes the metric a classification over the 1485 unordered pairs of 55
 * requests, which is also the right unit for the error asymmetry this project
 * cares about: one false merge is one wrong pair, and a merge of two large
 * problems is many.
 */
export type Confusion = {
  /** Grouped together, and the labels agree. */
  tp: number;
  /** Grouped together, and the labels disagree — a **false merge**. */
  fp: number;
  /** Should be together, and are not — a false split. */
  fn: number;
  tn: number;
};

export type Metrics = Confusion & {
  /** `null` when nothing was grouped at all: precision is undefined, not 1. */
  precision: number | null;
  recall: number;
  f1: number | null;
  pairs: number;
};

/**
 * @param ids      every request in the universe, so true negatives are real
 * @param groupOf  the pipeline's partition: request id → problem id
 * @param labelOf  ground truth: request id → label key
 */
export function pairwise(
  ids: readonly string[],
  groupOf: (id: string) => string | undefined,
  labelOf: (id: string) => string | undefined,
): Metrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let tn = 0;

  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const grouped = groupOf(ids[i]) === groupOf(ids[j]);
      const labelA = labelOf(ids[i]);
      const labelB = labelOf(ids[j]);
      // An unlabelled request cannot be scored either way; labels.ts is
      // asserted bijective against the corpus, so this is a guard, not a path.
      if (labelA === undefined || labelB === undefined) continue;
      const should = labelA === labelB;
      if (grouped && should) tp++;
      else if (grouped) fp++;
      else if (should) fn++;
      else tn++;
    }
  }

  const precision = tp + fp === 0 ? null : tp / (tp + fp);
  const recall = tp + fn === 0 ? 1 : tp / (tp + fn);
  const f1 =
    precision === null || precision + recall === 0 ? null : (2 * precision * recall) / (precision + recall);

  return { tp, fp, fn, tn, precision, recall, f1, pairs: tp + fp + fn + tn };
}

/**
 * One-sided 95% upper bound on an event rate after observing zero events in
 * `n` trials — the rule-of-three bound, `1 - 0.05^(1/n)`.
 *
 * Needed because "zero false merges" is a point estimate, and a selection rule
 * with a precision floor is only as strong as the sample that certifies it.
 */
export function zeroEventUpperBound(n: number): number | null {
  if (n <= 0) return null;
  return 1 - Math.pow(0.05, 1 / n);
}
