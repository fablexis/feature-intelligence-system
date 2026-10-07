import { eq, sql } from 'drizzle-orm';
import { canonicalText } from '../ai/canonical';
import { aiConfig } from '../ai/config';
import type { AiProvider } from '../ai/types';
import type { Db } from '../db/index';
import {
  dedupeSuggestions,
  evidenceLinks,
  problemLinks,
  problems,
  requests,
  scoreRuns,
  supports,
} from '../db/schema';
import { type Candidate, retrieveCandidates } from './retrieval';
import { type Resolution, resolve } from './resolve';
import { encodeVector, modelIdFor } from './vectors';

/**
 * The intake pipeline, stages 1-5.
 *
 * **Problem ids are derived from the request that formed them**
 * (`prob-<requestId>`), not generated. This is not cosmetic: an adjudication
 * input contains the candidate problem ids, so random ids would change the
 * fixture key on every run and every recorded verdict would miss.
 */
export const problemIdFor = (requestId: string) => `prob-${requestId}`;

export type StageTiming = { stage: string; ms: number; degraded: boolean };

export type IngestResult = {
  requestId: string;
  resolution: Resolution;
  candidates: Candidate[];
  timings: StageTiming[];
  degraded: boolean;
  /** True when retrieval had nothing to compare against, so no model was asked. */
  adjudicationSkipped: boolean;
};

export type IngestOptions = {
  tAuto: number;
  candidateLimit: number | 'all';
  minSimilarity: number;
  /**
   * Called as each stage completes, so a UI can show real progress rather than
   * one spinner. A 7s pipeline behind a single spinner reads as a hang, which
   * is the same failure as a timeout for a submitter with 60 seconds of
   * attention.
   */
  onStage?: (event: StageEvent) => void;
};

export type StageEvent = {
  stage: 'extract' | 'embed' | 'retrieve' | 'adjudicate' | 'resolve';
  ms: number;
  degraded: boolean;
  detail?: Record<string, unknown>;
};

export async function ingestRequest(
  db: Db,
  provider: AiProvider,
  request: { id: string; title: string; bodyRaw: string; source: ExtractSource },
  options: IngestOptions,
): Promise<IngestResult> {
  const cfg = aiConfig();
  const timings: StageTiming[] = [];
  const emit = (e: StageEvent) => {
    timings.push({ stage: e.stage, ms: e.ms, degraded: e.degraded });
    options.onStage?.(e);
  };
  const track = <T extends { meta: { latencyMs: number; degraded: boolean } }>(
    stage: StageEvent['stage'],
    r: T,
    detail?: Record<string, unknown>,
  ) => {
    emit({ stage, ms: r.meta.latencyMs, degraded: r.meta.degraded, detail });
    return r;
  };

  // 1 — extract
  const extracted = await provider.extractProblem({
    title: request.title,
    bodyRaw: request.bodyRaw,
    source: request.source,
  });
  const draft = extracted.value;
  track('extract', extracted, { statement: draft.statement, confidence: draft.confidence });

  // 2 — embed
  const embedded = await provider.embed({ text: canonicalText(draft) });
  const { vector, space } = embedded.value;
  track('embed', embedded, { dim: vector.length, space });

  // 3 — retrieve (deterministic, no model)
  const retrievalStart = Date.now();
  const retrieval = retrieveCandidates(db, vector, space, {
    limit: options.candidateLimit,
    minSimilarity: options.minSimilarity,
  });
  emit({
    stage: 'retrieve',
    ms: Date.now() - retrievalStart,
    degraded: retrieval.skippedForSpace > 0,
    detail: { candidates: retrieval.candidates.length, comparable: retrieval.comparable },
  });

  // 4 — adjudicate, but only when there is something to compare against.
  // No model call when the answer is already known.
  const adjudicationSkipped = retrieval.candidates.length === 0;
  let verdicts: Awaited<ReturnType<AiProvider['adjudicate']>>['value'] = [];
  if (adjudicationSkipped) {
    emit({ stage: 'adjudicate', ms: 0, degraded: false, detail: { skipped: true } });
  } else {
    const judged = await provider.adjudicate({ draft, candidates: retrieval.candidates });
    verdicts = judged.value;
    track('adjudicate', judged, {
      same: verdicts.filter((v) => v.relation === 'same').length,
      related: verdicts.filter((v) => v.relation === 'related').length,
    });
  }

  // 5 — resolve (deterministic, no model)
  const resolution = resolve(verdicts, retrieval.candidates, options.tAuto);
  emit({
    stage: 'resolve',
    ms: 0,
    degraded: false,
    detail:
      resolution.kind === 'attach'
        ? { outcome: resolution.auto ? 'auto-attach' : 'needs-confirmation', problemId: resolution.problemId, score: resolution.score }
        : { outcome: 'create-new', related: resolution.related.length },
  });
  const degraded = timings.some((t) => t.degraded) || retrieval.skippedForSpace > 0;

  // ─── persist ──────────────────────────────────────────────────────────────

  // Every (request, candidate, verdict) tuple is stored, including the ones
  // that lost. That exhaustive store is what lets C7 sweep thresholds offline.
  for (const candidate of retrieval.candidates) {
    const verdict = verdicts.find((v) => v.problemId === candidate.problemId);
    const chosen = resolution.kind === 'attach' && resolution.problemId === candidate.problemId;
    db.insert(dedupeSuggestions)
      .values({
        id: `sug-${request.id}-${candidate.problemId}`,
        requestId: request.id,
        candidateProblemId: candidate.problemId,
        similarity: candidate.similarity,
        verdict: verdict?.relation ?? 'distinct',
        verdictConfidence: verdict?.confidence ?? null,
        rationale: verdict?.rationale ?? null,
        humanAction: chosen ? (resolution.auto ? 'auto' : 'unsure') : null,
        actedAt: chosen && resolution.auto ? new Date() : null,
      })
      .onConflictDoNothing()
      .run();
  }

  if (resolution.kind === 'attach') {
    db.insert(evidenceLinks)
      .values({
        id: `ev-${request.id}`,
        requestId: request.id,
        problemId: resolution.problemId,
        createdBy: 'ai',
        confidence: resolution.score,
        suggestionId: `sug-${request.id}-${resolution.problemId}`,
        // Below T_auto: attached, but a PM still owes it a look.
        needsReview: !resolution.auto,
      })
      .onConflictDoNothing()
      .run();

    // A second `same` verdict claims two existing problems are each other.
    for (const other of resolution.alsoSame) {
      linkRelated(db, resolution.problemId, other);
    }
    for (const other of resolution.related) {
      linkRelated(db, resolution.problemId, other);
    }
  } else {
    const problemId = problemIdFor(request.id);
    db.insert(problems)
      .values({
        id: problemId,
        statement: draft.statement,
        jobToBeDone: draft.jobToBeDone,
        currentWorkaround: draft.currentWorkaround,
        blockedOutcome: draft.blockedOutcome,
        embedding: encodeVector(vector),
        embeddingModel: modelIdFor(space, cfg.modelEmbed),
      })
      .onConflictDoNothing()
      .run();
    db.insert(evidenceLinks)
      .values({
        id: `ev-${request.id}`,
        requestId: request.id,
        problemId,
        createdBy: 'ai',
        confidence: draft.confidence,
        needsReview: false,
      })
      .onConflictDoNothing()
      .run();
    for (const other of resolution.related) linkRelated(db, problemId, other);
  }

  db.update(requests)
    .set({
      resolution: resolution.kind === 'attach' ? 'attached' : 'created',
      triagedAt: new Date(),
      degraded,
    })
    .where(eq(requests.id, request.id))
    .run();

  return {
    requestId: request.id,
    resolution,
    candidates: retrieval.candidates,
    timings,
    degraded,
    adjudicationSkipped,
  };
}

type ExtractSource = 'csm_note' | 'ae_note' | 'support_ticket' | 'internal' | 'customer_direct';

/** Undirected in meaning, so the pair is stored in a canonical order. */
function linkRelated(db: Db, a: string, b: string) {
  if (a === b) return;
  const [low, high] = [a, b].sort();
  db.insert(problemLinks)
    .values({
      id: `rel-${low}-${high}`,
      problemAId: low,
      problemBId: high,
      kind: 'related',
      createdBy: 'ai',
    })
    .onConflictDoNothing()
    .run();
}

/**
 * Clears everything that hangs off a pipeline-formed problem, leaving the
 * seeded corpus intact. Returns what it discarded that a human had created, so
 * the caller can say so rather than losing it quietly.
 *
 * Ingest rebuilds rather than resuming because formation is order-dependent: a
 * partial re-ingest would form problems against a half-built corpus and
 * produce a different, non-reproducible result.
 *
 * **`supports` has to go too, and that is a real loss worth naming.** A support
 * row is a human's vote, not pipeline output — but it references a problem the
 * pipeline formed, so leaving it would fail the foreign key on the `problems`
 * delete and make `npm run ingest` unrunnable the moment anyone clicks "this
 * affects us too". Carrying it forward is worse than deleting it: the problem
 * set is being rebuilt, so a row would end up pointing at a problem that may
 * never be re-formed, or at a different grouping than the one the person
 * actually voted on. Re-pointing someone's vote without asking is the error
 * this whole product exists to avoid.
 */
export function resetDerived(db: Db): { discardedSupports: number } {
  const discardedSupports = db.select({ id: supports.id }).from(supports).all().length;
  db.delete(scoreRuns).run();
  db.delete(dedupeSuggestions).run();
  db.delete(problemLinks).run();
  db.delete(supports).run();
  db.delete(evidenceLinks).run();
  db.delete(problems).run();
  db.update(requests)
    .set({ resolution: null, triagedAt: null, degraded: false })
    .where(sql`1 = 1`)
    .run();
  return { discardedSupports };
}
