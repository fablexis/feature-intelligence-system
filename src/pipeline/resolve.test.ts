import { describe, expect, it } from 'vitest';
import type { Verdict } from '../ai/schemas';
import type { Candidate } from './retrieval';
import { autoScore, resolve } from './resolve';

const cand = (problemId: string, similarity: number): Candidate => ({
  problemId,
  statement: `s-${problemId}`,
  currentWorkaround: `w-${problemId}`,
  similarity,
});

const verdict = (
  problemId: string,
  relation: Verdict['relation'],
  confidence: number,
): Verdict => ({ problemId, relation, confidence, rationale: 'because' });

const T = 0.8;

describe('autoScore', () => {
  it('takes the weaker of the two agreeing signals', () => {
    expect(autoScore(0.95, 0.74)).toBeCloseTo(0.74);
    expect(autoScore(0.6, 0.99)).toBeCloseTo(0.6);
  });
});

describe('resolve — formation follows the verdict, not the threshold', () => {
  const candidates = [cand('p1', 0.74), cand('p2', 0.95)];

  it('attaches on a `same` verdict even when similarity is below T_auto', () => {
    // 0.741 is the worst true duplicate measured on the corpus. A threshold
    // design would have created a duplicate problem here.
    const r = resolve([verdict('p1', 'same', 0.9)], [cand('p1', 0.741)], T);
    expect(r.kind).toBe('attach');
    if (r.kind !== 'attach') return;
    expect(r.problemId).toBe('p1');
    expect(r.auto).toBe(false); // flagged for a human, not rejected
  });

  it('attaches automatically only when BOTH signals clear T_auto', () => {
    const high = resolve([verdict('p2', 'same', 0.92)], [cand('p2', 0.95)], T);
    expect(high.kind === 'attach' && high.auto).toBe(true);

    const lowConfidence = resolve([verdict('p2', 'same', 0.5)], [cand('p2', 0.95)], T);
    expect(lowConfidence.kind === 'attach' && lowConfidence.auto).toBe(false);

    const lowSimilarity = resolve([verdict('p2', 'same', 0.99)], [cand('p2', 0.5)], T);
    expect(lowSimilarity.kind === 'attach' && lowSimilarity.auto).toBe(false);
  });

  it('changing T_auto never changes formation — only the review flag', () => {
    const verdicts = [verdict('p1', 'same', 0.9)];
    const cs = [cand('p1', 0.741)];
    const strict = resolve(verdicts, cs, 0.95);
    const loose = resolve(verdicts, cs, 0.5);
    expect(strict.kind).toBe('attach');
    expect(loose.kind).toBe('attach');
    expect(strict.kind === 'attach' && strict.problemId).toBe('p1');
    expect(loose.kind === 'attach' && loose.problemId).toBe('p1');
    // …which is precisely what makes C7's sweep exact.
    expect(strict.kind === 'attach' && strict.auto).toBe(false);
    expect(loose.kind === 'attach' && loose.auto).toBe(true);
  });

  it('creates a new problem when nothing is `same`, keeping related links', () => {
    const r = resolve(
      [verdict('p1', 'related', 0.8), verdict('p2', 'distinct', 0.9)],
      candidates,
      T,
    );
    expect(r).toEqual({ kind: 'create', related: ['p1'] });
  });

  it('creates a new problem when every verdict is distinct', () => {
    const r = resolve([verdict('p1', 'distinct', 0.9)], candidates, T);
    expect(r).toEqual({ kind: 'create', related: [] });
  });

  it('creates a new problem when there are no candidates at all', () => {
    expect(resolve([], [], T)).toEqual({ kind: 'create', related: [] });
  });

  it('picks the strongest `same` and keeps the runners-up as a merge claim', () => {
    const r = resolve(
      [verdict('p1', 'same', 0.99), verdict('p2', 'same', 0.99)],
      candidates,
      T,
    );
    expect(r.kind).toBe('attach');
    if (r.kind !== 'attach') return;
    expect(r.problemId).toBe('p2'); // similarity 0.95 beats 0.74
    // Not discarded: the adjudicator effectively claimed p1 and p2 are also
    // the same problem, which is a merge a PM should see.
    expect(r.alsoSame).toEqual(['p1']);
  });

  it('ignores a verdict for a candidate that was never offered', () => {
    const r = resolve([verdict('ghost', 'same', 1)], candidates, T);
    expect(r).toEqual({ kind: 'create', related: [] });
  });

  it('is deterministic when scores tie, so fixtures reproduce', () => {
    const cs = [cand('p-b', 0.9), cand('p-a', 0.9)];
    const vs = [verdict('p-b', 'same', 0.9), verdict('p-a', 'same', 0.9)];
    const r = resolve(vs, cs, T);
    expect(r.kind === 'attach' && r.problemId).toBe('p-a');
  });
});
