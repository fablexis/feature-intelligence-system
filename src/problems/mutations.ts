/**
 * The three writes the problem detail page needs, as plain functions over a
 * `Db`.
 *
 * Separated from the Server Actions that call them for the same reason
 * `withDecisionLog` is separate from the providers: these stay testable without
 * Next, and the Next layer stays a thin shell that only knows about redirects
 * and revalidation.
 *
 * Human-in-the-loop points H2 ("un-merge / re-parent evidence") and the
 * re-pointed vote. Both are append-or-flag operations: **nothing here deletes a
 * row.** A merge that cannot be undone is a merge nobody should have been
 * allowed to make automatically ([ADR 0005](../../docs/adr/0005-duplicate-resolution-actor.md)).
 */
import { eq } from 'drizzle-orm';
import type { Db } from '../db/index';
import { dedupeSuggestions, evidenceLinks, humanOverrides, supports } from '../db/schema';
import { supportExists } from './evidence';

/** No auth in core, so the actor is named honestly rather than invented. */
export const ACTOR = 'demo-reviewer';

/** `note` is a short, stable key the page turns into a sentence. */
export type MutationResult = { ok: boolean; note: string; problemId?: string };

/**
 * "This affects us too" — one click, **idempotent per account**.
 *
 * Idempotency is enforced twice on purpose. The unique index on
 * `(problem_id, account_id)` is the guarantee; the pre-check is what lets the
 * UI say "already recorded" rather than reporting a swallowed conflict as
 * success. The vote attaches to a *problem*, never to a proposed solution —
 * that re-pointing is the product's central move.
 */
export function addSupport(
  db: Db,
  { problemId, accountId }: { problemId: string; accountId: string },
): MutationResult {
  if (!problemId || !accountId) return { ok: false, note: 'missing', problemId };
  if (supportExists(db, problemId, accountId)) {
    return { ok: true, note: 'support-duplicate', problemId };
  }
  db.insert(supports).values({ problemId, accountId, actor: ACTOR }).onConflictDoNothing().run();
  return { ok: true, note: 'support-added', problemId };
}

/**
 * Un-merge: flip `evidence_links.active` to false.
 *
 * The request itself is untouched — `body_raw` is immutable — so it reappears
 * intact in the problem's detached list, one click from being re-attached. The
 * override is appended so the disagreement survives even if the link is later
 * re-attached, and the suggestion that proposed the merge is marked `rejected`,
 * which is what makes M1's counterfactual computable without a separate
 * experiment.
 */
export function detachEvidence(db: Db, linkId: string): MutationResult {
  const link = db.select().from(evidenceLinks).where(eq(evidenceLinks.id, linkId)).get();
  if (!link) return { ok: false, note: 'unknown-link' };
  if (!link.active) return { ok: true, note: 'already-detached', problemId: link.problemId };

  db.update(evidenceLinks).set({ active: false }).where(eq(evidenceLinks.id, linkId)).run();

  if (link.suggestionId) {
    db.update(dedupeSuggestions)
      .set({ humanAction: 'rejected', actedAt: new Date() })
      .where(eq(dedupeSuggestions.id, link.suggestionId))
      .run();
  }
  recordFlip(db, link.id, 'true', 'false', 'un-merged from the problem detail view');
  return { ok: true, note: 'detached', problemId: link.problemId };
}

/**
 * Re-attach what an un-merge detached.
 *
 * Reversibility has to run both ways to be worth claiming, and here it costs
 * one flag. `needsReview` is cleared because a human has now looked at it,
 * which is the whole point of the flag.
 */
export function reattachEvidence(db: Db, linkId: string): MutationResult {
  const link = db.select().from(evidenceLinks).where(eq(evidenceLinks.id, linkId)).get();
  if (!link) return { ok: false, note: 'unknown-link' };
  if (link.active) return { ok: true, note: 'already-attached', problemId: link.problemId };

  db.update(evidenceLinks)
    .set({ active: true, needsReview: false })
    .where(eq(evidenceLinks.id, linkId))
    .run();
  recordFlip(db, link.id, 'false', 'true', 're-attached from the problem detail view');
  return { ok: true, note: 'reattached', problemId: link.problemId };
}

/**
 * `human_overrides` is append-only, so a second flip appends a second row
 * rather than editing the first. The history is the product (M3): suggested and
 * final are both retained forever.
 */
function recordFlip(db: Db, linkId: string, from: string, to: string, reason: string) {
  db.insert(humanOverrides)
    .values({
      targetType: 'merge',
      targetId: linkId,
      field: 'active',
      suggestedValue: from,
      finalValue: to,
      reason,
      actor: ACTOR,
    })
    .run();
}
