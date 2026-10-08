/**
 * Reads behind the PM review queue and the AI-provenance blocks (E1).
 *
 * Nothing here is new product logic: the flagged population has been countable
 * since C3 (`evidence_links.needs_review`), and every verdict shown has been
 * stored since C3 as well (`dedupe_suggestions`, including the candidates that
 * lost). [ADR 0005](../../docs/adr/0005-duplicate-resolution-actor.md) promised
 * a filtered queue over it and C4 deferred the view; this is the view.
 *
 * The join is deliberately `left`: an evidence link can carry
 * `needs_review` without a suggestion behind it — a submitter's split creates
 * exactly that — and such a row must still appear in the queue rather than
 * vanishing because its provenance is missing.
 */
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/index';
import {
  accounts,
  aiDecisions,
  dedupeSuggestions,
  evidenceLinks,
  humanOverrides,
  problems,
  requests,
} from '../db/schema';

/** Flagged *and still attached* — a detached link is no longer a pending ask. */
const PENDING = and(eq(evidenceLinks.needsReview, true), eq(evidenceLinks.active, true));

export function flaggedCount(db: Db): number {
  const row = db
    .select({ n: sql<number>`count(*)` })
    .from(evidenceLinks)
    .where(PENDING)
    .get();
  return row?.n ?? 0;
}

export type ReviewItem = {
  linkId: string;
  requestId: string;
  /** The verbatim request, which is what the PM is actually judging. */
  title: string;
  bodyRaw: string;
  source: string;
  accountName: string | null;
  segment: string | null;
  arrUsd: number | null;
  /** The problem the pipeline attached it to. */
  problemId: string;
  problemStatement: string;
  problemWorkaround: string;
  /** The attach score stored on the link, which is the cosine at intake. */
  linkConfidence: number | null;
  verdict: string | null;
  verdictConfidence: number | null;
  similarity: number | null;
  rationale: string | null;
  /** True when the request itself came through the n-gram fallback. */
  degraded: boolean;
  createdBy: string;
};

/**
 * The queue, oldest first.
 *
 * Oldest first because an aged queue is the failure mode PRODUCT's lifecycle
 * map describes: sorting by confidence would front-load the easy confirmations
 * and leave the hard ones to age forever.
 */
export function reviewQueue(db: Db): ReviewItem[] {
  return db
    .select({
      linkId: evidenceLinks.id,
      requestId: requests.id,
      title: requests.title,
      bodyRaw: requests.bodyRaw,
      source: requests.source,
      accountName: accounts.name,
      segment: accounts.segment,
      arrCents: accounts.arrCents,
      problemId: problems.id,
      problemStatement: problems.statement,
      problemWorkaround: problems.currentWorkaround,
      linkConfidence: evidenceLinks.confidence,
      verdict: dedupeSuggestions.verdict,
      verdictConfidence: dedupeSuggestions.verdictConfidence,
      similarity: dedupeSuggestions.similarity,
      rationale: dedupeSuggestions.rationale,
      degraded: requests.degraded,
      createdBy: evidenceLinks.createdBy,
    })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .innerJoin(problems, eq(evidenceLinks.problemId, problems.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .leftJoin(dedupeSuggestions, eq(evidenceLinks.suggestionId, dedupeSuggestions.id))
    .where(PENDING)
    .orderBy(asc(requests.createdAt))
    .all()
    .map((r) => ({
      ...r,
      arrUsd: r.arrCents === null ? null : Math.round(r.arrCents / 100),
    }));
}

export type LinkProvenance = {
  verdict: string | null;
  verdictConfidence: number | null;
  similarity: number | null;
  rationale: string | null;
  humanAction: string | null;
  changes: Array<{
    field: string;
    from: string | null;
    to: string | null;
    reason: string | null;
    actor: string;
  }>;
};

/**
 * Provenance per evidence link for one problem: what the adjudicator said, and
 * every human change recorded against that link afterwards.
 *
 * Two queries for the whole page rather than two per evidence row.
 */
export function provenanceForProblem(db: Db, problemId: string): Map<string, LinkProvenance> {
  const links = db
    .select({
      id: evidenceLinks.id,
      suggestionId: evidenceLinks.suggestionId,
      verdict: dedupeSuggestions.verdict,
      verdictConfidence: dedupeSuggestions.verdictConfidence,
      similarity: dedupeSuggestions.similarity,
      rationale: dedupeSuggestions.rationale,
      humanAction: dedupeSuggestions.humanAction,
    })
    .from(evidenceLinks)
    .leftJoin(dedupeSuggestions, eq(evidenceLinks.suggestionId, dedupeSuggestions.id))
    .where(eq(evidenceLinks.problemId, problemId))
    .all();

  const out = new Map<string, LinkProvenance>(
    links.map((l) => [
      l.id,
      {
        verdict: l.verdict,
        verdictConfidence: l.verdictConfidence,
        similarity: l.similarity,
        rationale: l.rationale,
        humanAction: l.humanAction,
        changes: [],
      },
    ]),
  );
  if (links.length === 0) return out;

  const overrides = db
    .select()
    .from(humanOverrides)
    .where(
      and(
        eq(humanOverrides.targetType, 'merge'),
        inArray(
          humanOverrides.targetId,
          links.map((l) => l.id),
        ),
      ),
    )
    // Insertion order: append-only, so the last row is the one in force.
    .orderBy(sql`rowid asc`)
    .all();

  for (const row of overrides) {
    out.get(row.targetId)?.changes.push({
      field: row.field,
      from: row.suggestedValue,
      to: row.finalValue,
      reason: row.reason,
      actor: row.actor,
    });
  }
  return out;
}

/**
 * Which model and prompt version produced the factor estimate for a problem.
 *
 * `ai_decisions` already logs it per call (C8 instrumentation); the board had
 * no reason to read it until provenance became a visible requirement. Newest
 * `score` call wins, by insertion order.
 */
export function scoreProvenance(
  db: Db,
  problemIds: string[],
): Map<string, { modelId: string; promptVersion: string; provider: string }> {
  const out = new Map<string, { modelId: string; promptVersion: string; provider: string }>();
  if (problemIds.length === 0) return out;
  const rows = db
    .select({
      problemId: aiDecisions.problemId,
      modelId: aiDecisions.modelId,
      promptVersion: aiDecisions.promptVersion,
      provider: aiDecisions.provider,
    })
    .from(aiDecisions)
    .where(and(eq(aiDecisions.stage, 'score'), inArray(aiDecisions.problemId, problemIds)))
    .orderBy(sql`rowid desc`)
    .all();
  for (const row of rows) {
    if (!row.problemId || out.has(row.problemId)) continue;
    out.set(row.problemId, {
      modelId: row.modelId,
      promptVersion: row.promptVersion,
      provider: row.provider,
    });
  }
  return out;
}
