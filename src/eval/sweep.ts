/**
 * The offline threshold sweep.
 *
 * The canonical pass records **every** `(request, candidate, verdict,
 * confidence, similarity)` tuple, including the ones that lost
 * (`dedupe_suggestions`). Stage 5 is deterministic arithmetic over exactly
 * those tuples, so re-deciding it at a different threshold needs no model and
 * no network — the sweep replays stage 5, not the pipeline.
 *
 * Two properties make this exact rather than approximate:
 *
 *  - **`T_auto` never changes formation.** It moves an attach between the auto
 *    and flagged bands and nothing else (ADR 0002's formation-by-verdict
 *    amendment), so every `T_auto` row is the system's real behaviour.
 *  - **`T_ask` is pinned at 0 in the shipped code**, structurally: `resolve()`
 *    attaches on any `same` verdict and has no `T_ask` parameter. The non-zero
 *    `T_ask` rows below are therefore a **counterfactual** — they say what
 *    raising it would have cost. See `askBlindSpot` for the one gap they carry.
 *
 * To keep the sweep honest it reuses the production functions (`autoScore`,
 * `problemIdFor`) rather than reimplementing them, and the harness asserts the
 * reconstructed partition equals the pipeline's own `evidence_links`.
 */
import { autoScore } from '../pipeline/resolve';
import { problemIdFor } from '../pipeline/ingest';
import { type Metrics, pairwise } from './pairwise';

export type Relation = 'same' | 'related' | 'distinct';

/** One recorded adjudication tuple. */
export type Tuple = {
  requestId: string;
  problemId: string;
  similarity: number;
  verdict: Relation;
  confidence: number | null;
};

export type RecordedRun = {
  /** Ingest order. Formation is order-dependent, so this is part of the data. */
  order: readonly string[];
  tuples: readonly Tuple[];
};

/** Which band's behaviour to measure: everything, or only what ran unattended. */
export type Band = 'all' | 'auto';

export type Thresholds = { tAsk: number; tAuto: number };

const EMPTY: readonly Tuple[] = [];

function byRequest(run: RecordedRun): Map<string, Tuple[]> {
  const map = new Map<string, Tuple[]>();
  for (const t of run.tuples) {
    const list = map.get(t.requestId);
    if (list) list.push(t);
    else map.set(t.requestId, [t]);
  }
  return map;
}

/**
 * The best `same` verdict for a request, scored exactly as stage 5 scores it.
 * Ties break on problem id so the result is deterministic.
 */
export function bestSame(tuples: readonly Tuple[]): { tuple: Tuple; score: number } | undefined {
  return tuples
    .filter((t) => t.verdict === 'same')
    .map((tuple) => ({ tuple, score: autoScore(tuple.confidence ?? 0, tuple.similarity) }))
    .sort((a, b) => b.score - a.score || a.tuple.problemId.localeCompare(b.tuple.problemId))[0];
}

/**
 * Re-run stage 5 at the given thresholds and return the resulting partition:
 * request id → problem id.
 *
 * A request that does not attach becomes its own problem, using the same
 * derived id the pipeline would mint. In the `auto` band a flagged attach is
 * *not* applied, because the auto band is by definition what the system does
 * with no human present.
 */
export function partition(run: RecordedRun, { tAsk, tAuto }: Thresholds, band: Band = 'all'): Map<string, string> {
  const tuples = byRequest(run);
  const out = new Map<string, string>();
  for (const id of run.order) {
    const best = bestSame(tuples.get(id) ?? EMPTY);
    const floor = band === 'auto' ? Math.max(tAsk, tAuto) : tAsk;
    out.set(id, best && best.score >= floor ? best.tuple.problemId : problemIdFor(id));
  }
  return out;
}

export type AttachCounts = {
  /** Requests that attached to an existing problem. */
  attached: number;
  /** …of which, above `T_auto`: no human asked. */
  auto: number;
  /** …of which, below `T_auto`: attached but flagged for a PM. */
  flagged: number;
  /** Requests that formed a new problem. */
  created: number;
  /** Distinct problems in the resulting partition. */
  problems: number;
  /** Share of attaches that need a human look. */
  reviewLoad: number | null;
};

export function attachCounts(run: RecordedRun, { tAsk, tAuto }: Thresholds): AttachCounts {
  const tuples = byRequest(run);
  let auto = 0;
  let flagged = 0;
  for (const id of run.order) {
    const best = bestSame(tuples.get(id) ?? EMPTY);
    if (!best || best.score < tAsk) continue;
    if (best.score >= tAuto) auto++;
    else flagged++;
  }
  const attached = auto + flagged;
  return {
    attached,
    auto,
    flagged,
    created: run.order.length - attached,
    problems: new Set(partition(run, { tAsk, tAuto }).values()).size,
    reviewLoad: attached === 0 ? null : flagged / attached,
  };
}

/**
 * How many problems a `T_ask` above 0 would have created that later requests
 * were never adjudicated against.
 *
 * This is the sweep's **only** approximation, and it is zero at `T_ask = 0`.
 * Raising `T_ask` can only turn an attach into a new problem, so every problem
 * the canonical pass formed still exists and every recorded verdict still
 * applies — but the extra problems were never offered to the requests that
 * arrived after them, so a counterfactual row cannot see attaches to them.
 */
export function askBlindSpot(run: RecordedRun, tAsk: number): number {
  const tuples = byRequest(run);
  let blind = 0;
  for (const id of run.order) {
    const best = bestSame(tuples.get(id) ?? EMPTY);
    if (best && best.score < tAsk) blind++;
  }
  return blind;
}

export type Cell = Thresholds & {
  all: Metrics;
  auto: Metrics;
  counts: AttachCounts;
  /** Non-zero only when `T_ask > 0`; see `askBlindSpot`. */
  blindSpot: number;
};

export function sweep(
  run: RecordedRun,
  labelOf: (id: string) => string | undefined,
  grid: readonly number[],
): Cell[] {
  const ids = [...run.order];
  const cells: Cell[] = [];
  for (const tAuto of grid) {
    for (const tAsk of grid) {
      // A `T_ask` above `T_auto` is not an operating point: it would ask for
      // confirmation of nothing while auto-attaching below the ask floor.
      if (tAsk > tAuto) continue;
      const thresholds = { tAsk, tAuto };
      const all = partition(run, thresholds, 'all');
      const auto = partition(run, thresholds, 'auto');
      cells.push({
        ...thresholds,
        all: pairwise(ids, (id) => all.get(id), labelOf),
        auto: pairwise(ids, (id) => auto.get(id), labelOf),
        counts: attachCounts(run, thresholds),
        blindSpot: askBlindSpot(run, tAsk),
      });
    }
  }
  return cells;
}

export type Selection = {
  /** `null` when no cell clears the precision floor — the rule has failed. */
  chosen: Cell | null;
  rule: { minAutoPrecision: number; minRecall: number };
  /** True when *every* cell clears the precision floor, so it decided nothing. */
  precisionNonBinding: boolean;
  /** True when no cell reaches the recall floor at the chosen `T_auto`. */
  recallUnsatisfiable: boolean;
  /** Best recall available anywhere on the grid, for the report. */
  bestRecall: number;
};

/**
 * The selection rule, fixed in advance (ARCHITECTURE § Choosing thresholds):
 * **the lowest `T_auto` whose auto-merge precision ≥ 0.90, then the lowest
 * `T_ask` keeping recall ≥ 0.60.**
 *
 * Two readings had to be pinned down, because the rule is written as if the
 * two axes were independent and they are not:
 *
 *  - A `T_auto` is judged at `T_ask = 0`, the most permissive formation and so
 *    the hardest precision test it faces. Conservative in the direction a
 *    precision-protecting rule should be conservative.
 *  - If no cell reaches the recall floor, the rule is reported as
 *    **unsatisfiable** and the recall-maximising `T_ask` is returned, which is
 *    the lowest one. Nothing is silently relaxed.
 */
export function applySelectionRule(
  cells: readonly Cell[],
  rule = { minAutoPrecision: 0.9, minRecall: 0.6 },
): Selection {
  const clears = (c: Cell) => c.auto.precision !== null && c.auto.precision >= rule.minAutoPrecision;
  const bestRecall = Math.max(...cells.map((c) => c.all.recall));
  const base = { rule, bestRecall };

  // Judge T_auto on the most permissive formation available for it.
  const judged = new Map<number, Cell>();
  for (const c of cells) {
    const incumbent = judged.get(c.tAuto);
    if (!incumbent || c.tAsk < incumbent.tAsk) judged.set(c.tAuto, c);
  }
  const admissible = [...judged.values()].filter(clears).sort((a, b) => a.tAuto - b.tAuto);
  /**
   * "Non-binding" means the constraint separated nothing among the cells where
   * it is *defined*. A `T_auto` above every recorded score has an empty auto
   * band and therefore undefined precision — that is absence of evidence, not a
   * precision failure, so counting it as one would hide the degeneracy.
   */
  const defined = [...judged.values()].filter((c) => c.auto.precision !== null);
  const precisionNonBinding = defined.length > 1 && defined.every(clears);

  if (admissible.length === 0) {
    return { ...base, chosen: null, precisionNonBinding: false, recallUnsatisfiable: true };
  }

  const tAuto = admissible[0].tAuto;
  const row = cells.filter((c) => c.tAuto === tAuto).sort((a, b) => a.tAsk - b.tAsk);
  const satisfying = row.filter((c) => c.all.recall >= rule.minRecall);
  return {
    ...base,
    chosen: satisfying[0] ?? row[0],
    precisionNonBinding,
    recallUnsatisfiable: satisfying.length === 0,
  };
}

export type CeilingRow = { k: number | 'all'; available: number; total: number; share: number };

/**
 * **Stage-1 recall ceiling, reported separately from end-to-end precision** —
 * ADR 0002's closing requirement, so a retrieval ceiling is never misread as an
 * adjudication failure.
 *
 * For every true pair, the later request can only be grouped with the earlier
 * one if retrieval put the earlier one's problem in front of the adjudicator.
 * This measures that share — at the shipped breadth (every problem) and at the
 * top-*k* breadths ADR 0003's scaling trigger will have to choose between.
 *
 * The top-*k* rows hold the canonical formation fixed: they are the ceiling a
 * narrower retrieval would have imposed on *this* problem set, not a full
 * re-simulation.
 */
export function stageOneCeiling(
  run: RecordedRun,
  labelOf: (id: string) => string | undefined,
  ks: readonly (number | 'all')[],
  canonical: Map<string, string>,
): CeilingRow[] {
  const tuples = byRequest(run);
  const position = new Map(run.order.map((id, i) => [id, i]));
  // Retrieval's own order: similarity desc, id as the deterministic tie-break.
  const ranked = new Map(
    run.order.map((id) => [
      id,
      [...(tuples.get(id) ?? EMPTY)]
        .sort((a, b) => b.similarity - a.similarity || a.problemId.localeCompare(b.problemId))
        .map((t) => t.problemId),
    ]),
  );

  const counts = new Map<number | 'all', number>(ks.map((k) => [k, 0]));
  let total = 0;

  for (const later of run.order) {
    for (const earlier of run.order) {
      if ((position.get(earlier) ?? 0) >= (position.get(later) ?? 0)) continue;
      if (labelOf(earlier) === undefined || labelOf(earlier) !== labelOf(later)) continue;
      total++;
      const target = canonical.get(earlier);
      const rank = ranked.get(later)?.indexOf(target ?? '') ?? -1;
      if (rank < 0) continue;
      for (const k of ks) if (k === 'all' || rank < k) counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  return ks.map((k) => {
    const available = counts.get(k) ?? 0;
    return { k, available, total, share: total === 0 ? 1 : available / total };
  });
}

/**
 * Which of the two signals `autoScore` combines actually decides the outcome.
 *
 * `autoScore` is `min(confidence, similarity)`. If confidence never binds, then
 * `T_auto` is a pure cosine cut in disguise — which matters, because C2
 * measured that cosine cannot separate duplicates from adjacent problems on
 * this corpus (worst duplicate 0.741 < best non-duplicate 0.772). A threshold
 * operating inside that band cannot be calibrated by similarity alone.
 */
export function bindingSignal(run: RecordedRun) {
  const sames = run.tuples.filter((t) => t.verdict === 'same');
  const confidences = sames.map((t) => t.confidence ?? 0);
  const similarities = sames.map((t) => t.similarity);
  const scores = sames.map((t) => autoScore(t.confidence ?? 0, t.similarity));
  return {
    sameVerdicts: sames.length,
    confidenceBinds: sames.filter((t) => (t.confidence ?? 0) < t.similarity).length,
    similarityBinds: sames.filter((t) => t.similarity <= (t.confidence ?? 0)).length,
    minConfidence: min(confidences),
    maxConfidence: max(confidences),
    minSimilarity: min(similarities),
    maxSimilarity: max(similarities),
    minScore: min(scores),
    maxScore: max(scores),
  };
}

const min = (xs: number[]) => (xs.length ? Math.min(...xs) : null);
const max = (xs: number[]) => (xs.length ? Math.max(...xs) : null);

export type Overlap = {
  n: number;
  /** Cosines between a request and a problem that genuinely is its own. */
  sameMin: number | null;
  sameMax: number | null;
  /** Cosines between a request and a problem from a different true cluster. */
  diffMin: number | null;
  diffMax: number | null;
  /** `sameMin - diffMax`. Negative means the two classes overlap. */
  separation: number | null;
  /**
   * The lowest value `T_auto` can take and still never auto-attach at a cosine
   * where a known non-duplicate also sits — i.e. just above `diffMax`.
   *
   * This is the one thing the corpus *does* say about `T_auto`. The selection
   * rule's precision constraint says nothing here (no false merge occurs at any
   * threshold), but the similarity distribution still marks a region where
   * cosine is demonstrably uninformative, and auto-attaching inside it means
   * acting unattended on a signal measured as unable to discriminate.
   */
  contestedAbove: number | null;
};

/**
 * C2's overlap finding, recomputed at the level `T_auto` actually operates on.
 *
 * C2 measured it over 11 planted and 3 adjacent *request* pairs. Every recorded
 * tuple is a (request, problem) comparison whose ground truth is known — the
 * problem's true cluster is the cluster of the request that formed it, because
 * problem ids are derived — so the same question can be asked over the whole
 * recorded set rather than 14 hand-picked pairs.
 */
export function labelledOverlap(
  run: RecordedRun,
  labelOf: (id: string) => string | undefined,
  formerOf: (problemId: string) => string | undefined,
): Overlap {
  const same: number[] = [];
  const diff: number[] = [];
  for (const t of run.tuples) {
    const a = labelOf(t.requestId);
    const former = formerOf(t.problemId);
    const b = former === undefined ? undefined : labelOf(former);
    if (a === undefined || b === undefined) continue;
    (a === b ? same : diff).push(t.similarity);
  }
  const sameMin = min(same);
  const diffMax = max(diff);
  return {
    n: same.length + diff.length,
    sameMin,
    sameMax: max(same),
    diffMin: min(diff),
    diffMax,
    separation: sameMin !== null && diffMax !== null ? sameMin - diffMax : null,
    contestedAbove: diffMax,
  };
}

/** Verdict mix across the whole recorded tuple set. */
export function verdictMix(run: RecordedRun): Record<Relation, number> {
  const mix: Record<Relation, number> = { same: 0, related: 0, distinct: 0 };
  for (const t of run.tuples) mix[t.verdict]++;
  return mix;
}

/** Did a named pair end up in one problem? Used for the planted-pair counts. */
export function pairOutcomes(
  part: Map<string, string>,
  pairs: readonly (readonly [string, string])[],
): { grouped: number; total: number; missed: string[] } {
  const missed: string[] = [];
  let grouped = 0;
  for (const [a, b] of pairs) {
    if (part.get(a) !== undefined && part.get(a) === part.get(b)) grouped++;
    else missed.push(`${a}/${b}`);
  }
  return { grouped, total: pairs.length, missed };
}
