import { and, eq } from 'drizzle-orm';
import { db } from '@/db';
import {
  dedupeSuggestions,
  evidenceLinks,
  humanOverrides,
  problems,
  requests,
} from '@/db/schema';
import { problemIdFor } from '@/pipeline/ingest';

/**
 * "Actually, mine is different" — the submitter's escape hatch.
 *
 * This is load-bearing, not a courtesy. A false merge is the expensive error
 * precisely because it is **invisible**: demand disappears into another
 * problem and nobody notices. This button converts that error class from
 * silent to self-reporting, and the disagreement it records is labelled
 * training data nobody had to pay for (ADR 0005).
 *
 * The merge is undone rather than deleted: the evidence link is deactivated,
 * so the original request survives verbatim and the history stays auditable.
 */
export async function POST(request: Request) {
  const form = await request.formData();
  const requestId = String(form.get('requestId') ?? '');
  const reason = String(form.get('reason') ?? 'submitter said this is a different problem');

  const row = db.select().from(requests).where(eq(requests.id, requestId)).get();
  if (!row) return Response.json({ error: 'unknown request' }, { status: 404 });

  const link = db
    .select()
    .from(evidenceLinks)
    .where(and(eq(evidenceLinks.requestId, requestId), eq(evidenceLinks.active, true)))
    .get();
  if (!link) return Response.json({ error: 'nothing attached to split' }, { status: 409 });

  // Deactivate, never delete.
  db.update(evidenceLinks).set({ active: false }).where(eq(evidenceLinks.id, link.id)).run();

  // Record the disagreement against the suggestion that caused it.
  if (link.suggestionId) {
    db.update(dedupeSuggestions)
      .set({ humanAction: 'rejected', actedAt: new Date() })
      .where(eq(dedupeSuggestions.id, link.suggestionId))
      .run();
  }
  db.insert(humanOverrides)
    .values({
      targetType: 'merge',
      targetId: link.id,
      field: 'problemId',
      suggestedValue: link.problemId,
      finalValue: problemIdFor(requestId),
      reason,
      actor: 'submitter',
    })
    .run();

  // The request becomes its own problem, carrying its extracted statement.
  const source = db.select().from(problems).where(eq(problems.id, link.problemId)).get();
  const newProblemId = problemIdFor(requestId);
  db.insert(problems)
    .values({
      id: newProblemId,
      statement: row.title,
      jobToBeDone: 'pending re-extraction',
      currentWorkaround: 'pending re-extraction',
      blockedOutcome: 'pending re-extraction',
      // Deliberately unembedded: it must be re-extracted and re-embedded
      // rather than inheriting vectors from the problem it was split from.
      embedding: null,
      embeddingModel: null,
    })
    .onConflictDoNothing()
    .run();
  db.insert(evidenceLinks)
    .values({
      id: `ev-${requestId}-split`,
      requestId,
      problemId: newProblemId,
      createdBy: 'human',
      confidence: null,
      needsReview: true,
    })
    .onConflictDoNothing()
    .run();
  db.update(requests).set({ resolution: 'created' }).where(eq(requests.id, requestId)).run();

  void source;
  return Response.redirect(new URL(`/problems/${newProblemId}`, request.url), 303);
}
