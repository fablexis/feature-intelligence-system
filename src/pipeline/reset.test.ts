import { describe, expect, it } from 'vitest';
import { createMemoryDb } from '../db/memory';
import {
  accounts,
  dedupeSuggestions,
  evidenceLinks,
  problems,
  requests,
  supports,
} from '../db/schema';
import { resetDerived } from './ingest';

/**
 * Regression: a single "this affects us too" click used to make `npm run
 * ingest` permanently unrunnable.
 *
 * `supports` references `problems`, so deleting the problem set failed the
 * foreign key and the whole command aborted with `FOREIGN KEY constraint
 * failed`. It went unnoticed until C4 made the table reachable from the UI —
 * before that, nothing ever wrote a support row.
 */
function seeded() {
  const db = createMemoryDb();
  db.insert(accounts).values({ id: 'acc-a', name: 'A', segment: 'smb', arrCents: 1 }).run();
  db.insert(requests)
    .values({ id: 'req-1', title: 't', bodyRaw: 'b', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-a' })
    .run();
  db.insert(problems)
    .values({ id: 'prob-req-1', statement: 's', jobToBeDone: 'j', currentWorkaround: 'w', blockedOutcome: 'b' })
    .run();
  db.insert(evidenceLinks)
    .values({ id: 'ev-1', requestId: 'req-1', problemId: 'prob-req-1', createdBy: 'ai' })
    .run();
  db.insert(dedupeSuggestions)
    .values({ id: 'sug-1', requestId: 'req-1', candidateProblemId: 'prob-req-1', similarity: 0.9, verdict: 'same' })
    .run();
  return db;
}

describe('resetDerived', () => {
  it('runs with a support row present, instead of failing the foreign key', () => {
    const db = seeded();
    db.insert(supports).values({ problemId: 'prob-req-1', accountId: 'acc-a', actor: 'x' }).run();
    expect(() => resetDerived(db)).not.toThrow();
    expect(db.select().from(problems).all()).toHaveLength(0);
    expect(db.select().from(supports).all()).toHaveLength(0);
  });

  it('reports what it discarded, so a lost human vote is not silent', () => {
    const db = seeded();
    db.insert(supports).values({ problemId: 'prob-req-1', accountId: 'acc-a', actor: 'x' }).run();
    expect(resetDerived(db)).toEqual({ discardedSupports: 1 });
  });

  it('reports nothing discarded when nobody had clicked', () => {
    expect(resetDerived(seeded())).toEqual({ discardedSupports: 0 });
  });

  it('leaves the seeded corpus intact and resets the requests it had triaged', () => {
    const db = seeded();
    resetDerived(db);
    const request = db.select().from(requests).all();
    expect(request).toHaveLength(1);
    expect(request[0].bodyRaw).toBe('b');
    expect(request[0].resolution).toBeNull();
    expect(db.select().from(accounts).all()).toHaveLength(1);
    expect(db.select().from(evidenceLinks).all()).toHaveLength(0);
    expect(db.select().from(dedupeSuggestions).all()).toHaveLength(0);
  });
});
