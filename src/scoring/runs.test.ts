import { describe, expect, it, beforeEach } from 'vitest';
import type { Factors } from '../ai/schemas';
import { stableStringify } from '../ai/hash';
import type { Db } from '../db/index';
import { createMemoryDb } from '../db/memory';
import {
  accounts,
  evidenceLinks,
  humanOverrides,
  problems,
  requests,
  scoreRuns,
  supports,
} from '../db/schema';
import { arrFor, citationIndex, factorsInputFor, latestBandOverrides, latestRuns, recordRun, runCounts } from './runs';
import { loadWeights, scoreProblem } from './score';

const W = loadWeights();
const factor = (score: number, citations: string[] = ['ev-1']) => ({ score, citations, reason: 'r' });
const makeFactors = (score: number): Factors => ({
  customerValue: factor(score),
  strategicFit: factor(score),
  evidenceStrength: factor(score),
  effort: factor(score),
  confidence: 0.6,
  tension: '',
});

let db: Db;

beforeEach(() => {
  db = createMemoryDb();
  db.insert(accounts)
    .values([
      { id: 'acc-big', name: 'Big Co', segment: 'enterprise', arrCents: 50_000_00 },
      { id: 'acc-small', name: 'Small Co', segment: 'smb', arrCents: 1_000_00 },
    ])
    .run();
  db.insert(problems)
    .values({ id: 'prob-1', statement: 's', jobToBeDone: 'j', currentWorkaround: 'w', blockedOutcome: 'b' })
    .run();
  db.insert(requests)
    .values([
      { id: 'req-1', title: 'one', bodyRaw: 'first', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-big' },
      { id: 'req-2', title: 'two', bodyRaw: 'second', submitterKind: 'customer', source: 'csm_note', accountId: 'acc-small' },
      { id: 'req-3', title: 'three', bodyRaw: 'third', submitterKind: 'internal', source: 'internal' },
    ])
    .run();
  db.insert(evidenceLinks)
    .values([
      { id: 'ev-1', requestId: 'req-1', problemId: 'prob-1', createdBy: 'ai' },
      { id: 'ev-2', requestId: 'req-2', problemId: 'prob-1', createdBy: 'ai' },
      { id: 'ev-3', requestId: 'req-3', problemId: 'prob-1', createdBy: 'ai' },
    ])
    .run();
});

describe('factorsInputFor is deterministic, because it is a fixture key', () => {
  it('hashes identically across calls', () => {
    const a = factorsInputFor(db, 'prob-1', { goals: [] });
    const b = factorsInputFor(db, 'prob-1', { goals: [] });
    expect(stableStringify(a)).toBe(stableStringify(b));
  });

  it('orders evidence by link id, not by insertion luck', () => {
    const input = factorsInputFor(db, 'prob-1', {});
    expect(input.evidence.map((e) => e.id)).toEqual(['ev-1', 'ev-2', 'ev-3']);
  });

  it('includes only active evidence, so an un-merge changes the input', () => {
    const before = stableStringify(factorsInputFor(db, 'prob-1', {}));
    db.update(evidenceLinks).set({ active: false }).run();
    const after = factorsInputFor(db, 'prob-1', {});
    expect(after.evidence).toHaveLength(0);
    expect(stableStringify(after)).not.toBe(before);
  });

  it('carries ARR and segment so customer value has the facts, not a guess', () => {
    const input = factorsInputFor(db, 'prob-1', {});
    expect(input.evidence[0]).toMatchObject({ accountName: 'Big Co', segment: 'enterprise', arrUsd: 50_000 });
    // An internal note has no account, and says so by omission.
    expect(input.evidence[2].accountName).toBeUndefined();
  });

  it('is unaffected by a "this affects us too" click', () => {
    // Supports must not enter the model input, or one click would miss every
    // recorded fixture for that problem.
    const before = stableStringify(factorsInputFor(db, 'prob-1', {}));
    db.insert(supports).values({ problemId: 'prob-1', accountId: 'acc-small', actor: 'x' }).run();
    expect(stableStringify(factorsInputFor(db, 'prob-1', {}))).toBe(before);
  });

  it('refuses an unknown problem instead of scoring nothing', () => {
    expect(() => factorsInputFor(db, 'nope', {})).toThrow(/unknown problem/);
  });
});

describe('score_runs is append-only', () => {
  const run = (score: number) =>
    recordRun(db, {
      problemId: 'prob-1',
      factors: makeFactors(score),
      scored: scoreProblem(makeFactors(score), W),
      modelId: 'test-model',
    });

  it('adds a row per score instead of overwriting', () => {
    run(0.2);
    run(0.9);
    expect(db.select().from(scoreRuns).all()).toHaveLength(2);
    expect(runCounts(db).get('prob-1')).toBe(2);
  });

  it('keeps the earlier band and its factors on the record', () => {
    run(0.2);
    run(0.9);
    const bands = db.select().from(scoreRuns).all().map((r) => r.band);
    expect(bands).toContain('no');
    expect(bands).toContain('now');
  });

  it('reads the newest run per problem, by insertion order', () => {
    run(0.2);
    run(0.9);
    // Both rows land in the same second, so a created_at tie-break would be
    // arbitrary. The newest must still win.
    expect(latestRuns(db).get('prob-1')?.factors.customerValue.score).toBe(0.9);
  });

  it('skips a row whose stored factors no longer match the schema', () => {
    run(0.5);
    db.update(scoreRuns).set({ factorsJson: { nonsense: true } }).run();
    // Better an unscored problem than a crash at render time.
    expect(latestRuns(db).size).toBe(0);
  });

  it('stores the weights version in force when it was written', () => {
    run(0.5);
    expect(latestRuns(db).get('prob-1')?.weightsVersion).toBe(W.version);
  });
});

describe('band overrides', () => {
  const override = (suggested: string, final: string, reason: string) =>
    db
      .insert(humanOverrides)
      .values({
        targetType: 'problem_band',
        targetId: 'prob-1',
        field: 'band',
        suggestedValue: suggested,
        finalValue: final,
        reason,
        actor: 'pm',
      })
      .run();

  it('reads the newest override per problem', () => {
    override('later', 'next', 'first call');
    override('next', 'now', 'changed my mind');
    const latest = latestBandOverrides(db).get('prob-1');
    expect(latest).toMatchObject({ final: 'now', reason: 'changed my mind' });
  });

  it('keeps the superseded judgement on record', () => {
    override('later', 'next', 'first call');
    override('next', 'now', 'changed my mind');
    expect(db.select().from(humanOverrides).all()).toHaveLength(2);
  });

  it('ignores overrides of other things', () => {
    db.insert(humanOverrides)
      .values({ targetType: 'merge', targetId: 'prob-1', field: 'active', actor: 'pm' })
      .run();
    expect(latestBandOverrides(db).size).toBe(0);
  });
});

describe('display helpers', () => {
  it('sums ARR once per distinct account', () => {
    expect(arrFor(db, 'prob-1')).toBe(51_000);
  });

  it('resolves a citation into a request a PM can read', () => {
    const index = citationIndex(db, 'prob-1');
    expect(index.get('ev-1')).toMatchObject({ title: 'one', accountName: 'Big Co' });
    expect(index.get('ev-3')?.accountName).toBeNull();
  });
});
