import { describe, expect, it } from 'vitest';
import { resolve } from '../pipeline/resolve';
import { pairwise } from './pairwise';
import {
  type Cell,
  type RecordedRun,
  applySelectionRule,
  askBlindSpot,
  attachCounts,
  bestSame,
  bindingSignal,
  labelledOverlap,
  pairOutcomes,
  partition,
  stageOneCeiling,
  sweep,
  verdictMix,
} from './sweep';

/**
 * A miniature recorded run. r2 matches r1 strongly, r3 matches it weakly, r4 is
 * a genuinely different problem — enough structure to exercise both bands and
 * both thresholds.
 */
const RUN: RecordedRun = {
  order: ['r1', 'r2', 'r3', 'r4'],
  tuples: [
    { requestId: 'r2', problemId: 'prob-r1', similarity: 0.9, verdict: 'same', confidence: 0.95 },
    { requestId: 'r3', problemId: 'prob-r1', similarity: 0.7, verdict: 'same', confidence: 0.9 },
    { requestId: 'r4', problemId: 'prob-r1', similarity: 0.5, verdict: 'distinct', confidence: 0.9 },
  ],
};

const LABELS: Record<string, string> = { r1: 'X', r2: 'X', r3: 'X', r4: 'Y' };
const labelOf = (id: string) => LABELS[id];
const GRID = [0, 0.6, 0.8, 0.95];

describe('partition', () => {
  it('attaches on a same verdict and gives every other request its own problem', () => {
    const p = partition(RUN, { tAsk: 0, tAuto: 0.8 });
    expect(p.get('r1')).toBe('prob-r1');
    expect(p.get('r2')).toBe('prob-r1');
    expect(p.get('r3')).toBe('prob-r1');
    expect(p.get('r4')).toBe('prob-r4');
  });

  it('drops flagged attaches in the auto band, because no human was there', () => {
    const p = partition(RUN, { tAsk: 0, tAuto: 0.8 }, 'auto');
    expect(p.get('r2')).toBe('prob-r1');
    expect(p.get('r3')).toBe('prob-r3');
  });

  it('agrees with the production resolve() on the same inputs', () => {
    // The sweep must not be a second implementation of stage 5 that can drift.
    for (const tAuto of [0.6, 0.75, 0.95]) {
      const candidates = [
        { problemId: 'prob-r1', statement: 's', currentWorkaround: 'w', similarity: 0.7 },
      ];
      const verdicts = [
        { problemId: 'prob-r1', relation: 'same' as const, confidence: 0.9, rationale: 'r' },
      ];
      const r = resolve(verdicts, candidates, tAuto);
      const all = partition(RUN, { tAsk: 0, tAuto }, 'all').get('r3');
      const auto = partition(RUN, { tAsk: 0, tAuto }, 'auto').get('r3');
      expect(r.kind).toBe('attach');
      if (r.kind !== 'attach') return;
      expect(all).toBe(r.problemId);
      expect(auto).toBe(r.auto ? r.problemId : 'prob-r3');
    }
  });

  it('breaks ties on problem id, so the sweep is deterministic', () => {
    const tied: RecordedRun = {
      order: ['rx'],
      tuples: [
        { requestId: 'rx', problemId: 'prob-b', similarity: 0.8, verdict: 'same', confidence: 0.9 },
        { requestId: 'rx', problemId: 'prob-a', similarity: 0.8, verdict: 'same', confidence: 0.9 },
      ],
    };
    expect(bestSame(tied.tuples)?.tuple.problemId).toBe('prob-a');
    expect(partition(tied, { tAsk: 0, tAuto: 0.5 }).get('rx')).toBe('prob-a');
  });
});

describe('the properties that make the sweep exact', () => {
  it('T_auto never changes formation — only which band an attach lands in', () => {
    const base = partition(RUN, { tAsk: 0, tAuto: 0 });
    for (const tAuto of [0.5, 0.7, 0.8, 0.99]) {
      expect(partition(RUN, { tAsk: 0, tAuto })).toEqual(base);
    }
  });

  it('T_ask = 0 has no blind spot; raising it creates one', () => {
    expect(askBlindSpot(RUN, 0)).toBe(0);
    expect(askBlindSpot(RUN, 0.8)).toBe(1); // r3 would form its own problem
  });

  it('raising T_ask only ever removes attaches', () => {
    const counts = GRID.map((tAsk) => attachCounts(RUN, { tAsk, tAuto: Math.max(tAsk, 0.8) }).attached);
    for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeLessThanOrEqual(counts[i - 1]);
  });

  it('keeps the auto band a subset of the all band', () => {
    for (const tAuto of GRID) {
      const all = partition(RUN, { tAsk: 0, tAuto });
      const auto = partition(RUN, { tAsk: 0, tAuto }, 'auto');
      const m = (p: Map<string, string>) => pairwise(RUN.order, (id) => p.get(id), labelOf);
      expect(m(auto).tp).toBeLessThanOrEqual(m(all).tp);
      expect(m(auto).fp).toBeLessThanOrEqual(m(all).fp);
    }
  });
});

describe('counts', () => {
  it('splits attaches into auto and flagged and prices the review load', () => {
    const c = attachCounts(RUN, { tAsk: 0, tAuto: 0.8 });
    expect(c).toMatchObject({ attached: 2, auto: 1, flagged: 1, created: 2, problems: 2 });
    expect(c.reviewLoad).toBeCloseTo(0.5);
  });

  it('reports review load as undefined when nothing attached', () => {
    expect(attachCounts(RUN, { tAsk: 0.99, tAuto: 0.99 }).reviewLoad).toBeNull();
  });
});

describe('the sweep grid', () => {
  const cells = sweep(RUN, labelOf, GRID);

  it('omits cells where T_ask exceeds T_auto', () => {
    expect(cells.every((c) => c.tAsk <= c.tAuto)).toBe(true);
    expect(cells).toHaveLength(10); // 4 choose 2 with repetition
  });

  it('gives every cell a complete confusion matrix', () => {
    for (const c of cells) {
      expect(c.all.tp + c.all.fp + c.all.fn + c.all.tn).toBe(6);
    }
  });

  it('holds all-band metrics constant along the T_auto axis', () => {
    const atZero = cells.filter((c) => c.tAsk === 0);
    const first = atZero[0].all;
    for (const c of atZero) expect(c.all).toEqual(first);
  });
});

describe('the selection rule', () => {
  const cells = sweep(RUN, labelOf, GRID);

  it('takes the lowest T_auto clearing the precision floor', () => {
    const s = applySelectionRule(cells, { minAutoPrecision: 0.9, minRecall: 0.6 });
    expect(s.chosen?.tAuto).toBe(0);
    expect(s.chosen?.tAsk).toBe(0);
  });

  it('reports the precision constraint as non-binding when every cell clears it', () => {
    // This corpus has no false merge at any threshold, so the floor decides nothing.
    const s = applySelectionRule(cells);
    expect(s.precisionNonBinding).toBe(true);
  });

  it('does not count an empty auto band as a precision breach', () => {
    const top = cells.find((c) => c.tAuto === 0.95 && c.tAsk === 0);
    expect(top?.auto.precision).toBeNull();
    expect(applySelectionRule(cells).precisionNonBinding).toBe(true);
  });

  it('flags an unsatisfiable recall floor instead of quietly relaxing it', () => {
    // r3 belongs with r1 and r2 but was judged `distinct`, so no threshold can
    // recover it — exactly the shape of this project's real recall gap.
    const partial: RecordedRun = {
      order: ['r1', 'r2', 'r3', 'r4'],
      tuples: [
        { requestId: 'r2', problemId: 'prob-r1', similarity: 0.9, verdict: 'same', confidence: 0.95 },
        { requestId: 'r3', problemId: 'prob-r1', similarity: 0.6, verdict: 'distinct', confidence: 0.9 },
        { requestId: 'r4', problemId: 'prob-r1', similarity: 0.5, verdict: 'distinct', confidence: 0.9 },
      ],
    };
    const s = applySelectionRule(sweep(partial, labelOf, GRID), {
      minAutoPrecision: 0.9,
      minRecall: 0.6,
    });
    expect(s.bestRecall).toBeCloseTo(1 / 3);
    expect(s.recallUnsatisfiable).toBe(true);
    // …and returns the recall-maximising T_ask rather than nothing at all.
    expect(s.chosen?.tAsk).toBe(0);
    expect(s.chosen?.all.precision).toBe(1);
  });

  it('selects nothing when the precision floor is unreachable', () => {
    const falseMerge: RecordedRun = {
      order: ['r1', 'r4'],
      tuples: [
        { requestId: 'r4', problemId: 'prob-r1', similarity: 0.99, verdict: 'same', confidence: 0.99 },
      ],
    };
    const bad: Cell[] = sweep(falseMerge, labelOf, [0, 0.5]);
    expect(applySelectionRule(bad).chosen).toBeNull();
  });
});

describe('stage-1 recall ceiling', () => {
  it('is 1.0 when retrieval returns every problem', () => {
    const canonical = partition(RUN, { tAsk: 0, tAuto: 0.8 });
    const [all] = stageOneCeiling(RUN, labelOf, ['all'], canonical);
    // Three true pairs among r1/r2/r3. r2–r3 counts because r3 was shown
    // prob-r1, which is the problem r2 lives in.
    expect(all).toMatchObject({ available: 3, total: 3, share: 1 });
  });

  it('falls when a narrower top-k hides the partner problem', () => {
    const crowded: RecordedRun = {
      order: ['r1', 'r4', 'r2'],
      tuples: [
        // r2's true partner (prob-r1) ranks second by similarity.
        { requestId: 'r2', problemId: 'prob-r4', similarity: 0.95, verdict: 'distinct', confidence: 0.9 },
        { requestId: 'r2', problemId: 'prob-r1', similarity: 0.9, verdict: 'same', confidence: 0.95 },
      ],
    };
    const canonical = partition(crowded, { tAsk: 0, tAuto: 0.8 });
    const rows = stageOneCeiling(crowded, labelOf, [1, 2, 'all'], canonical);
    expect(rows.map((r) => r.share)).toEqual([0, 1, 1]);
  });
});

describe('diagnostics', () => {
  it('reports which of the two signals autoScore actually binds on', () => {
    const b = bindingSignal(RUN);
    expect(b.sameVerdicts).toBe(2);
    // Both same verdicts have confidence above similarity, so cosine decides.
    expect(b.similarityBinds).toBe(2);
    expect(b.confidenceBinds).toBe(0);
    expect(b.minScore).toBeCloseTo(0.7);
  });

  it('measures where the two cosine classes overlap, over every labelled tuple', () => {
    const former = (problemId: string) =>
      problemId.startsWith('prob-') ? problemId.slice('prob-'.length) : undefined;
    const o = labelledOverlap(RUN, labelOf, former);
    // r2 (0.9) and r3 (0.7) are same-cluster; r4 (0.5) is not.
    expect(o).toMatchObject({ n: 3, sameMin: 0.7, sameMax: 0.9, diffMin: 0.5, diffMax: 0.5 });
    expect(o.separation).toBeCloseTo(0.2);
    // Separated here, so the uncontested line sits below the true matches.
    expect(o.contestedAbove).toBe(0.5);
  });

  it('reports a negative separation when the classes overlap', () => {
    const overlapping: RecordedRun = {
      order: ['r1', 'r4', 'r2'],
      tuples: [
        { requestId: 'r4', problemId: 'prob-r1', similarity: 0.85, verdict: 'distinct', confidence: 0.9 },
        { requestId: 'r2', problemId: 'prob-r1', similarity: 0.8, verdict: 'same', confidence: 0.95 },
      ],
    };
    const o = labelledOverlap(overlapping, labelOf, (p) => p.slice('prob-'.length));
    expect(o.separation).toBeCloseTo(-0.05);
    expect(o.contestedAbove).toBe(0.85);
  });

  it('counts the verdict mix over the whole tuple set', () => {
    expect(verdictMix(RUN)).toEqual({ same: 2, related: 0, distinct: 1 });
  });

  it('reports which named pairs ended up together', () => {
    const p = partition(RUN, { tAsk: 0, tAuto: 0.8 });
    expect(pairOutcomes(p, [['r1', 'r2'] as const, ['r1', 'r4'] as const])).toEqual({
      grouped: 1,
      total: 2,
      missed: ['r1/r4'],
    });
  });
});
