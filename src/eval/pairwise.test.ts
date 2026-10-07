import { describe, expect, it } from 'vitest';
import { pairwise, zeroEventUpperBound } from './pairwise';

const group = (m: Record<string, string>) => (id: string) => m[id];

describe('pairwise scoring', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const labels = group({ a: 'X', b: 'X', c: 'Y', d: 'Y' });

  it('scores a perfect partition as perfect', () => {
    const m = pairwise(ids, group({ a: '1', b: '1', c: '2', d: '2' }), labels);
    expect(m).toMatchObject({ tp: 2, fp: 0, fn: 0, tn: 4, precision: 1, recall: 1 });
    expect(m.pairs).toBe(6);
  });

  it('counts a merge across two labels as a false positive, not a miss', () => {
    const m = pairwise(ids, group({ a: '1', b: '1', c: '1', d: '2' }), labels);
    // a-b correct; a-c and b-c are false merges; c-d is now split.
    expect(m).toMatchObject({ tp: 1, fp: 2, fn: 1 });
    expect(m.precision).toBeCloseTo(1 / 3);
    expect(m.recall).toBeCloseTo(1 / 2);
  });

  it('calls precision undefined — not 1.0 — when nothing is grouped', () => {
    const m = pairwise(ids, group({ a: '1', b: '2', c: '3', d: '4' }), labels);
    expect(m.precision).toBeNull();
    expect(m.f1).toBeNull();
    expect(m.recall).toBe(0);
  });

  it('counts every pair exactly once, so the matrix is complete', () => {
    const m = pairwise(ids, group({ a: '1', b: '1', c: '1', d: '2' }), labels);
    expect(m.tp + m.fp + m.fn + m.tn).toBe(6);
  });

  it('is independent of how the pipeline happens to name its problems', () => {
    const a = pairwise(ids, group({ a: 'p1', b: 'p1', c: 'p2', d: 'p2' }), labels);
    const b = pairwise(ids, group({ a: 'zz', b: 'zz', c: 'aa', d: 'aa' }), labels);
    expect(a).toEqual(b);
  });

  it('skips unlabelled requests rather than scoring them as negatives', () => {
    const m = pairwise(['a', 'b', 'e'], group({ a: '1', b: '1', e: '1' }), labels);
    expect(m.pairs).toBe(1);
    expect(m).toMatchObject({ tp: 1, fp: 0 });
  });
});

describe('zero-event upper bound', () => {
  it('is the rule of three: ~3/n for usable n', () => {
    expect(zeroEventUpperBound(30)).toBeCloseTo(0.0953, 3);
    expect(zeroEventUpperBound(100)).toBeCloseTo(0.0295, 3);
  });

  it('is undefined with no trials', () => {
    expect(zeroEventUpperBound(0)).toBeNull();
  });

  it('shows 32 attaches cannot certify a 0.90 precision floor', () => {
    // The floor leaves 10% of headroom; the bound after 32 clean attaches is
    // wider than that, which is why C7 reports the constraint as uncertified.
    expect(zeroEventUpperBound(32)!).toBeGreaterThan(0.08);
  });
});
