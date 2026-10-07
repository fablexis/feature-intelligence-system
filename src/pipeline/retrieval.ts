import { isNull } from 'drizzle-orm';
import { cosine } from '../ai/ngram';
import type { EmbeddingSpace } from '../ai/types';
import type { Db } from '../db/index';
import { problems } from '../db/schema';
import { decodeVector, spaceOf } from './vectors';

/**
 * Stage 3 — recall. A brute-force cosine scan over problem embeddings, which
 * is the right answer at this scale ([ADR 0003](../../docs/adr/0003-brute-force-cosine.md)).
 *
 * The space rule is load-bearing, not bookkeeping: cosine between a Gemini
 * vector and an n-gram vector is **meaningless**, not merely worse, because
 * they share no geometry. Comparing across spaces would return confident
 * nonsense, which is worse than returning nothing. So candidates in a
 * different space are excluded and counted, and the caller reports `degraded`.
 */
export type Candidate = {
  problemId: string;
  statement: string;
  currentWorkaround: string;
  similarity: number;
};

export type Retrieval = {
  candidates: Candidate[];
  /** Problems skipped because their embedding lives in another space. */
  skippedForSpace: number;
  /** Problems with no embedding at all. */
  skippedUnembedded: number;
  /** Problems considered, i.e. comparable with the query. */
  comparable: number;
};

export type RetrieveOptions = {
  /**
   * How many candidates to return. `'all'` is the default and the right choice
   * at this corpus size: it removes the retrieval recall ceiling entirely, so
   * the adjudicator sees every existing problem and an offline threshold sweep
   * has no unrecorded gaps.
   */
  limit?: number | 'all';
  /** Floor below which a candidate is not worth a model's attention. */
  minSimilarity?: number;
};

export function retrieveCandidates(
  db: Db,
  query: Float32Array,
  querySpace: EmbeddingSpace,
  options: RetrieveOptions = {},
): Retrieval {
  const { limit = 'all', minSimilarity = 0 } = options;

  // Merged problems are not retrieval targets; their evidence lives on the survivor.
  const rows = db
    .select({
      id: problems.id,
      statement: problems.statement,
      currentWorkaround: problems.currentWorkaround,
      embedding: problems.embedding,
      embeddingModel: problems.embeddingModel,
    })
    .from(problems)
    .where(isNull(problems.mergedIntoId))
    .all();

  let skippedForSpace = 0;
  let skippedUnembedded = 0;
  const scored: Candidate[] = [];

  for (const row of rows) {
    if (!row.embedding) {
      skippedUnembedded++;
      continue;
    }
    if (spaceOf(row.embeddingModel) !== querySpace) {
      skippedForSpace++;
      continue;
    }
    const vector = decodeVector(row.embedding as Buffer);
    if (vector.length !== query.length) {
      // A dimension change is a space change in all but name.
      skippedForSpace++;
      continue;
    }
    scored.push({
      problemId: row.id,
      statement: row.statement,
      currentWorkaround: row.currentWorkaround,
      similarity: cosine(query, vector),
    });
  }

  const comparable = scored.length;
  const ranked = scored
    .filter((c) => c.similarity >= minSimilarity)
    // Tie-break on id so the order is deterministic and fixtures reproduce.
    .sort((a, b) => b.similarity - a.similarity || a.problemId.localeCompare(b.problemId));

  return {
    candidates: limit === 'all' ? ranked : ranked.slice(0, limit),
    skippedForSpace,
    skippedUnembedded,
    comparable,
  };
}
