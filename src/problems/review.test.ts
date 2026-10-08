/**
 * The review queue and the provenance behind it (E1).
 *
 * The queue is a filter plus two writes, so what is worth pinning is the
 * filter's edges and the fact that both decisions leave a record: a confirmed
 * attach and a rejected one must be equally visible afterwards, or M3's
 * override rate measures only disagreement and reads as if nobody agreed.
 */
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { createMemoryDb } from '../db/memory';
import {
  accounts,
  dedupeSuggestions,
  evidenceLinks,
  humanOverrides,
  problems,
  requests,
} from '../db/schema';
import { confirmEvidence, detachEvidence } from './mutations';
import { flaggedCount, provenanceForProblem, reviewQueue } from './provenance';

let db: Db;

/**
 * One problem, three attaches: one clean, one flagged with a suggestion behind
 * it, one flagged with no suggestion at all (which is what a submitter's split
 * produces, and which must still reach the queue).
 */
beforeEach(() => {
  db = createMemoryDb();
  db.insert(accounts)
    .values({ id: 'acc-a', name: 'Account A', segment: 'enterprise', arrCents: 123_400 })
    .run();
  db.insert(problems)
    .values({
      id: 'prob-1',
      statement: 'a shared problem',
      jobToBeDone: 'j',
      currentWorkaround: 'w',
      blockedOutcome: 'b',
    })
    .run();
  db.insert(requests)
    .values([
      { id: 'req-1', title: 'one', bodyRaw: 'clean', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-a' },
      { id: 'req-2', title: 'two', bodyRaw: 'flagged', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-a' },
      { id: 'req-3', title: 'three', bodyRaw: 'split', submitterKind: 'internal', source: 'internal' },
    ])
    .run();
  db.insert(dedupeSuggestions)
    .values({
      id: 'sug-2',
      requestId: 'req-2',
      candidateProblemId: 'prob-1',
      similarity: 0.77,
      verdict: 'same',
      verdictConfidence: 0.91,
      rationale: 'both describe the same underlying problem',
      humanAction: 'unsure',
    })
    .run();
  db.insert(evidenceLinks)
    .values([
      { id: 'ev-1', requestId: 'req-1', problemId: 'prob-1', createdBy: 'ai', confidence: 0.9 },
      { id: 'ev-2', requestId: 'req-2', problemId: 'prob-1', createdBy: 'ai', confidence: 0.77, suggestionId: 'sug-2', needsReview: true },
      { id: 'ev-3', requestId: 'req-3', problemId: 'prob-1', createdBy: 'human', confidence: null, needsReview: true },
    ])
    .run();
});

describe('the queue is flagged AND still attached', () => {
  it('lists only the flagged attaches, oldest first', () => {
    expect(flaggedCount(db)).toBe(2);
    const queue = reviewQueue(db);
    expect(queue.map((i) => i.linkId)).toEqual(['ev-2', 'ev-3']);
  });

  it('keeps an attach with no suggestion behind it rather than dropping it', () => {
    // A submitter's split flags a link with no adjudication. An inner join on
    // dedupe_suggestions would silently hide exactly the rows a human asked to
    // see.
    const split = reviewQueue(db).find((i) => i.linkId === 'ev-3');
    expect(split).toBeDefined();
    expect(split?.verdict).toBeNull();
    expect(split?.createdBy).toBe('human');
  });

  it('carries the verbatim request and the account context the PM judges on', () => {
    const item = reviewQueue(db)[0];
    expect(item.bodyRaw).toBe('flagged');
    expect(item.problemStatement).toBe('a shared problem');
    expect(item.verdict).toBe('same');
    expect(item.verdictConfidence).toBe(0.91);
    expect(item.similarity).toBe(0.77);
    expect(item.arrUsd).toBe(1234);
  });

  it('drops a rejected attach out of the queue', () => {
    detachEvidence(db, 'ev-2', 'review-queue');
    expect(flaggedCount(db)).toBe(1);
    expect(reviewQueue(db).map((i) => i.linkId)).toEqual(['ev-3']);
  });
});

describe('confirming records the agreement', () => {
  it('clears the flag, marks the suggestion accepted and appends history', () => {
    expect(confirmEvidence(db, 'ev-2')).toMatchObject({ ok: true, note: 'confirmed' });

    const link = db.select().from(evidenceLinks).where(eq(evidenceLinks.id, 'ev-2')).get();
    expect(link?.needsReview).toBe(false);
    // Still attached: confirming changes who vouches for the attach, not the attach.
    expect(link?.active).toBe(true);

    const suggestion = db
      .select()
      .from(dedupeSuggestions)
      .where(eq(dedupeSuggestions.id, 'sug-2'))
      .get();
    expect(suggestion?.humanAction).toBe('accepted');
    expect(suggestion?.actedAt).toBeInstanceOf(Date);

    const override = db.select().from(humanOverrides).all();
    expect(override).toHaveLength(1);
    expect(override[0]).toMatchObject({
      targetType: 'merge',
      targetId: 'ev-2',
      field: 'needs_review',
      suggestedValue: 'true',
      finalValue: 'false',
    });
  });

  it('is idempotent and never writes a second row for the same decision', () => {
    confirmEvidence(db, 'ev-2');
    expect(confirmEvidence(db, 'ev-2')).toMatchObject({ note: 'already-confirmed' });
    expect(db.select().from(humanOverrides).all()).toHaveLength(1);
  });

  it('refuses to confirm an attach that was already un-merged', () => {
    detachEvidence(db, 'ev-2', 'review-queue');
    expect(confirmEvidence(db, 'ev-2')).toMatchObject({ ok: false, note: 'confirm-detached' });
  });

  it('reports an unknown link rather than writing anything', () => {
    expect(confirmEvidence(db, 'nope')).toMatchObject({ ok: false, note: 'unknown-link' });
    expect(db.select().from(humanOverrides).all()).toHaveLength(0);
  });
});

describe('provenance pairs the verdict with what a human changed', () => {
  it('returns the adjudication and every recorded change on the link', () => {
    confirmEvidence(db, 'ev-2');
    detachEvidence(db, 'ev-2', 'review-queue');

    const prov = provenanceForProblem(db, 'prob-1').get('ev-2');
    expect(prov?.verdict).toBe('same');
    expect(prov?.rationale).toBe('both describe the same underlying problem');
    // Append-only: the confirmation survives the later rejection.
    expect(prov?.changes.map((c) => c.field)).toEqual(['needs_review', 'active']);
    expect(prov?.changes[1].reason).toContain('review-queue');
  });

  it('has an entry for every link, including one the model never judged', () => {
    const prov = provenanceForProblem(db, 'prob-1');
    expect([...prov.keys()].sort()).toEqual(['ev-1', 'ev-2', 'ev-3']);
    expect(prov.get('ev-1')?.verdict).toBeNull();
    expect(prov.get('ev-1')?.changes).toEqual([]);
  });
});
