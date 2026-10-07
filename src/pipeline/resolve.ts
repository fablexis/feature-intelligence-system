import type { Verdict } from '../ai/schemas';
import type { Candidate } from './retrieval';

/**
 * Stage 5 — resolution.
 *
 * **Formation follows the adjudicator's verdict, not a similarity threshold.**
 * That is a measured decision, not a preference: on this corpus the worst true
 * duplicate scores 0.741 while the best adjacent-but-distinct pair scores
 * 0.772, so the two classes overlap and no cosine threshold separates them
 * (docs/eval-results.md). A number that cannot tell duplicates from neighbours
 * must not be the thing that decides identity.
 *
 * `T_auto` therefore governs only **how much human oversight an attach needs**,
 * never whether the attach happens. Three practical consequences:
 *
 *  - formation is threshold-independent, so C7's sweep over `T_auto` is exact
 *    rather than an approximation of a different formation order;
 *  - a confirming pass at the chosen threshold reproduces the identical
 *    problem set, so it costs zero new API calls;
 *  - a wrong merge is caught by a human in the flagged band rather than by a
 *    threshold — and the danger of a false merge is invisibility, which a flag
 *    removes by construction.
 */
export type Resolution =
  | {
      kind: 'attach';
      problemId: string;
      /** False means attached but flagged for PM confirmation. */
      auto: boolean;
      score: number;
      verdict: Verdict;
      /** Other problems the adjudicator also called `same` — see below. */
      alsoSame: string[];
      related: string[];
    }
  | { kind: 'create'; related: string[] };

/**
 * The single scalar `T_auto` is applied to.
 *
 * `min` rather than a product: auto-attaching without a human should require
 * that **both** signals agree, and the weaker of two agreeing signals is more
 * interpretable in the UI than a multiplied value whose magnitude means
 * nothing on its own.
 */
export const autoScore = (confidence: number, similarity: number) =>
  Math.min(confidence, similarity);

export function resolve(
  verdicts: Verdict[],
  candidates: Candidate[],
  tAuto: number,
): Resolution {
  const similarity = new Map(candidates.map((c) => [c.problemId, c.similarity]));
  const known = (v: Verdict) => similarity.has(v.problemId);

  const sames = verdicts
    .filter((v) => v.relation === 'same' && known(v))
    .map((v) => ({ v, score: autoScore(v.confidence, similarity.get(v.problemId) ?? 0) }))
    .sort((a, b) => b.score - a.score || a.v.problemId.localeCompare(b.v.problemId));

  const related = verdicts
    .filter((v) => v.relation === 'related' && known(v))
    .map((v) => v.problemId)
    .sort();

  if (sames.length === 0) return { kind: 'create', related };

  const [best, ...rest] = sames;
  return {
    kind: 'attach',
    problemId: best.v.problemId,
    auto: best.score >= tAuto,
    score: best.score,
    verdict: best.v,
    /**
     * A second `same` verdict is the adjudicator claiming two *existing*
     * problems are also each other — which is a merge the PM should see, not
     * something to silently discard. Recorded as `related` links from the
     * attached problem so the claim survives.
     */
    alsoSame: rest.map((r) => r.v.problemId),
    related,
  };
}
