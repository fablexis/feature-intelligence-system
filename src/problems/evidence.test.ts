import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Db } from '../db/index';
import { createMemoryDb } from '../db/memory';
import { accounts, evidenceLinks, humanOverrides, problems, requests, supports } from '../db/schema';
import { evidenceFor, problemStats, statsFor, supportExists } from './evidence';
import { addSupport, detachEvidence, reattachEvidence } from './mutations';

let db: Db;

/**
 * Two accounts, one unattributed internal note, one problem holding three
 * requests. Small enough to reason about by hand, which is the point: every
 * expectation below should be checkable by counting.
 */
beforeEach(() => {
  db = createMemoryDb();
  db.insert(accounts)
    .values([
      { id: 'acc-a', name: 'Account A', segment: 'enterprise', arrCents: 100 },
      { id: 'acc-b', name: 'Account B', segment: 'smb', arrCents: 10 },
      { id: 'acc-c', name: 'Account C', segment: 'mid', arrCents: 50 },
    ])
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
      // Two requests from the SAME account, to prove accounts are deduplicated.
      { id: 'req-1', title: 'one', bodyRaw: 'the first words', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-a' },
      { id: 'req-2', title: 'two', bodyRaw: 'the second words', submitterKind: 'customer', source: 'customer_direct', accountId: 'acc-a' },
      { id: 'req-3', title: 'three', bodyRaw: 'the third words', submitterKind: 'customer', source: 'support_ticket', accountId: 'acc-b' },
      // An internal note carries no account at all.
      { id: 'req-4', title: 'four', bodyRaw: 'an internal argument', submitterKind: 'internal', source: 'internal' },
    ])
    .run();
  db.insert(evidenceLinks)
    .values([
      { id: 'ev-1', requestId: 'req-1', problemId: 'prob-1', createdBy: 'ai', confidence: 0.9, suggestionId: null },
      { id: 'ev-2', requestId: 'req-2', problemId: 'prob-1', createdBy: 'ai', confidence: 0.75, needsReview: true },
      { id: 'ev-3', requestId: 'req-3', problemId: 'prob-1', createdBy: 'ai', confidence: 0.85 },
      { id: 'ev-4', requestId: 'req-4', problemId: 'prob-1', createdBy: 'ai', confidence: 0.8 },
    ])
    .run();
});

describe('evidence strength is a distinct account count', () => {
  it('counts accounts, not requests', () => {
    const s = statsFor(db, 'prob-1');
    expect(s.requestCount).toBe(4);
    // acc-a wrote twice; an internal note has no account to count.
    expect(s.writeInAccounts).toBe(2);
    expect(s.strength).toBe(2);
  });

  it('is not ARR-weighted — the enterprise account counts the same as the SMB one', () => {
    // Open question 2: ARR reaches the ranking through customer_value alone.
    const before = statsFor(db, 'prob-1').strength;
    db.update(accounts).set({ arrCents: 99_999_999 }).where(eq(accounts.id, 'acc-a')).run();
    expect(statsFor(db, 'prob-1').strength).toBe(before);
  });

  it('counts a clicking account once, even if it also wrote in', () => {
    addSupport(db, { problemId: 'prob-1', accountId: 'acc-a' }); // already wrote in
    const s = statsFor(db, 'prob-1');
    expect(s.supportOnlyAccounts).toBe(0);
    expect(s.strength).toBe(2);
  });

  it('adds a clicking account that never wrote in', () => {
    addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' });
    const s = statsFor(db, 'prob-1');
    expect(s.supportOnlyAccounts).toBe(1);
    expect(s.strength).toBe(3);
  });

  it('counts only active evidence', () => {
    detachEvidence(db, 'ev-3'); // the only acc-b request
    const s = statsFor(db, 'prob-1');
    expect(s.requestCount).toBe(3);
    expect(s.detached).toBe(1);
    expect(s.strength).toBe(1);
  });

  it('reports the flagged population rather than hiding it', () => {
    expect(statsFor(db, 'prob-1').needsReview).toBe(1);
  });

  it('gives the same answer batched as it does one at a time', () => {
    // The list page batches; the detail page does not. They must not diverge.
    db.insert(problems)
      .values({ id: 'prob-2', statement: 's', jobToBeDone: 'j', currentWorkaround: 'w', blockedOutcome: 'b' })
      .run();
    addSupport(db, { problemId: 'prob-2', accountId: 'acc-c' });

    const batched = problemStats(db);
    expect([...batched.keys()].sort()).toEqual(['prob-1', 'prob-2']);
    expect(batched.get('prob-1')).toEqual(statsFor(db, 'prob-1'));
    expect(batched.get('prob-2')).toEqual(statsFor(db, 'prob-2'));
    // A problem with a click but no requests still has strength.
    expect(batched.get('prob-2')).toMatchObject({ requestCount: 0, strength: 1 });
  });
});

describe('"this affects us too" is one click, idempotent per account', () => {
  it('records the first click', () => {
    expect(addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' })).toMatchObject({
      ok: true,
      note: 'support-added',
    });
    expect(supportExists(db, 'prob-1', 'acc-c')).toBe(true);
  });

  it('is a no-op on the second click, and says so', () => {
    addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' });
    expect(addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' })).toMatchObject({
      note: 'support-duplicate',
    });
    expect(db.select().from(supports).all()).toHaveLength(1);
  });

  it('keeps the count stable however many times it is clicked', () => {
    for (let i = 0; i < 5; i++) addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' });
    expect(statsFor(db, 'prob-1').strength).toBe(3);
  });

  it('still allows a different account to say the same thing', () => {
    addSupport(db, { problemId: 'prob-1', accountId: 'acc-c' });
    addSupport(db, { problemId: 'prob-1', accountId: 'acc-b' });
    expect(db.select().from(supports).all()).toHaveLength(2);
    // acc-b already wrote in, so strength only gains acc-c.
    expect(statsFor(db, 'prob-1').strength).toBe(3);
  });

  it('refuses an incomplete submission instead of writing a half row', () => {
    expect(addSupport(db, { problemId: 'prob-1', accountId: '' }).ok).toBe(false);
    expect(db.select().from(supports).all()).toHaveLength(0);
  });
});

describe('un-merge flips active and the request reappears intact', () => {
  it('flips the flag rather than deleting the row', () => {
    detachEvidence(db, 'ev-1');
    const link = db.select().from(evidenceLinks).where(eq(evidenceLinks.id, 'ev-1')).get();
    expect(link).toBeDefined();
    expect(link?.active).toBe(false);
  });

  it('leaves the request verbatim and findable', () => {
    detachEvidence(db, 'ev-1');
    const request = db.select().from(requests).where(eq(requests.id, 'req-1')).get();
    expect(request?.bodyRaw).toBe('the first words');
    expect(request?.title).toBe('one');
    // …and it is still listed on the problem, as detached.
    const detached = evidenceFor(db, 'prob-1').filter((e) => !e.active);
    expect(detached.map((d) => d.bodyRaw)).toEqual(['the first words']);
  });

  it('records the disagreement in an append-only override', () => {
    detachEvidence(db, 'ev-1');
    const overrides = db.select().from(humanOverrides).all();
    expect(overrides).toHaveLength(1);
    expect(overrides[0]).toMatchObject({
      targetType: 'merge',
      targetId: 'ev-1',
      field: 'active',
      suggestedValue: 'true',
      finalValue: 'false',
    });
  });

  it('is reversible, and the reversal appends rather than edits', () => {
    detachEvidence(db, 'ev-2');
    expect(reattachEvidence(db, 'ev-2')).toMatchObject({ note: 'reattached' });
    const link = db.select().from(evidenceLinks).where(eq(evidenceLinks.id, 'ev-2')).get();
    expect(link?.active).toBe(true);
    // A human has now looked at it, which is what the flag was for.
    expect(link?.needsReview).toBe(false);
    expect(db.select().from(humanOverrides).all()).toHaveLength(2);
  });

  it('is idempotent in both directions', () => {
    detachEvidence(db, 'ev-1');
    expect(detachEvidence(db, 'ev-1')).toMatchObject({ note: 'already-detached' });
    reattachEvidence(db, 'ev-1');
    expect(reattachEvidence(db, 'ev-1')).toMatchObject({ note: 'already-attached' });
    // Two real flips, so two overrides — the no-ops added nothing.
    expect(db.select().from(humanOverrides).all()).toHaveLength(2);
  });

  it('reports an unknown link instead of throwing', () => {
    expect(detachEvidence(db, 'nope')).toMatchObject({ ok: false, note: 'unknown-link' });
  });
});
