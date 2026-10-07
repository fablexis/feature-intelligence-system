import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SEED_ACCOUNTS } from './accounts';
import { sharedContentWords } from './disjoint';
import {
  DEMO_REQUEST_LABEL,
  DISJOINT_PAIRS,
  PROBLEM_LABELS,
  RELATED_PAIRS,
  REQUEST_LABELS,
} from './labels';
import { DEMO_REQUEST, SEED_REQUESTS } from './requests';

const byId = new Map(SEED_REQUESTS.map((r) => [r.id, r]));
const text = (id: string) => {
  const r = byId.get(id);
  if (!r) throw new Error(`unknown request: ${id}`);
  return `${r.title} ${r.bodyRaw}`;
};

describe('corpus shape', () => {
  it('has 40–60 requests across ~12 problems', () => {
    expect(SEED_REQUESTS.length).toBeGreaterThanOrEqual(40);
    expect(SEED_REQUESTS.length).toBeLessThanOrEqual(60);
    expect(Object.keys(PROBLEM_LABELS)).toHaveLength(12);
  });

  it('labels every request exactly once, with no orphans either way', () => {
    const ids = SEED_REQUESTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(REQUEST_LABELS).sort()).toEqual([...ids].sort());
  });

  it('uses every problem label and every channel', () => {
    const used = new Set(Object.values(REQUEST_LABELS));
    expect(used.size).toBe(12);
    const channels = new Set(SEED_REQUESTS.map((r) => r.source));
    expect([...channels].sort()).toEqual([
      'ae_note',
      'csm_note',
      'customer_direct',
      'internal',
      'support_ticket',
    ]);
  });

  it('gives accounts a real ARR spread across all three segments', () => {
    const segments = new Set(SEED_ACCOUNTS.map((a) => a.segment));
    expect([...segments].sort()).toEqual(['enterprise', 'mid', 'smb']);
    const arrs = SEED_ACCOUNTS.map((a) => a.arrCents);
    expect(Math.max(...arrs) / Math.min(...arrs.filter((v) => v > 0))).toBeGreaterThan(50);
  });

  it('points every account reference at a real account', () => {
    const slugs = new Set(SEED_ACCOUNTS.map((a) => a.slug));
    for (const r of SEED_REQUESTS) {
      if (r.accountSlug) expect(slugs).toContain(r.accountSlug);
    }
    expect(slugs).toContain(DEMO_REQUEST.accountSlug);
  });
});

describe('planted disjoint pairs', () => {
  it('provides at least eight', () => {
    expect(DISJOINT_PAIRS.length).toBeGreaterThanOrEqual(8);
  });

  it('shares no content word within any pair', () => {
    const offenders = DISJOINT_PAIRS.map(([a, b]) => ({
      pair: `${a}/${b}`,
      shared: sharedContentWords(text(a), text(b)),
    })).filter((o) => o.shared.length > 0);
    expect(offenders).toEqual([]);
  });

  it('plants both halves of each pair on the same problem', () => {
    for (const [a, b] of DISJOINT_PAIRS) {
      expect(REQUEST_LABELS[a]).toBe(REQUEST_LABELS[b]);
    }
  });
});

describe('related-but-distinct pairs', () => {
  it('provides at least two, each on genuinely different problems', () => {
    expect(RELATED_PAIRS.length).toBeGreaterThanOrEqual(2);
    for (const { a, b } of RELATED_PAIRS) {
      expect(REQUEST_LABELS[a]).not.toBe(REQUEST_LABELS[b]);
    }
  });
});

describe('scripted demo request', () => {
  it('shares no content word with any request on its target problem', () => {
    const targets = SEED_REQUESTS.filter((r) => REQUEST_LABELS[r.id] === DEMO_REQUEST_LABEL);
    expect(targets.length).toBeGreaterThan(0);
    const demo = `${DEMO_REQUEST.title} ${DEMO_REQUEST.bodyRaw}`;
    const offenders = targets
      .map((r) => ({ id: r.id, shared: sharedContentWords(demo, text(r.id)) }))
      .filter((o) => o.shared.length > 0);
    expect(offenders).toEqual([]);
  });

  it('is not part of the seeded corpus — it is typed live in the demo', () => {
    expect(SEED_REQUESTS.some((r) => r.title === DEMO_REQUEST.title)).toBe(false);
  });
});

describe('demo story is carried by the data, not by labels', () => {
  const arrFor = (slug?: string) =>
    SEED_ACCOUNTS.find((a) => a.slug === slug)?.arrCents ?? 0;
  const stats = (label: string) => {
    const rs = SEED_REQUESTS.filter((r) => REQUEST_LABELS[r.id] === label);
    const slugs = new Set(rs.map((r) => r.accountSlug).filter(Boolean) as string[]);
    return {
      accounts: slugs.size,
      arr: [...slugs].reduce((sum, s) => sum + arrFor(s), 0),
    };
  };

  it('makes the popular problem broad but low-value, and the strategic one the reverse', () => {
    const popular = stats('P11_ALERT_SCOPING');
    const strategic = stats('P12_DATA_RESIDENCY');

    // (a) most distinct accounts of any problem…
    const widest = Math.max(
      ...Object.keys(PROBLEM_LABELS).map((l) => stats(l).accounts),
    );
    expect(popular.accounts).toBe(widest);

    // …but (b) the strategic problem carries an order of magnitude more ARR
    expect(strategic.accounts).toBeLessThan(popular.accounts);
    expect(strategic.arr).toBeGreaterThan(popular.arr * 5);
  });

  it('builds the popular problem entirely from small accounts', () => {
    const rs = SEED_REQUESTS.filter((r) => REQUEST_LABELS[r.id] === 'P11_ALERT_SCOPING');
    for (const r of rs) {
      expect(SEED_ACCOUNTS.find((a) => a.slug === r.accountSlug)?.segment).toBe('smb');
    }
  });

  it('builds the strategic problem entirely from enterprise accounts', () => {
    const rs = SEED_REQUESTS.filter((r) => REQUEST_LABELS[r.id] === 'P12_DATA_RESIDENCY');
    for (const r of rs) {
      expect(SEED_ACCOUNTS.find((a) => a.slug === r.accountSlug)?.segment).toBe('enterprise');
    }
  });
});

describe('no label leakage', () => {
  it('keeps ground truth out of the seed script', () => {
    const src = readFileSync('./scripts/seed.ts', 'utf8');
    // No import of the labels module, by any path spelling…
    expect(src).not.toMatch(/^\s*import[^;]*from\s*['"][^'"]*labels['"]/m);
    expect(src).not.toMatch(/require\(['"][^'"]*labels['"]\)/);
    // …and no reference to anything it exports.
    expect(src).not.toMatch(
      /REQUEST_LABELS|PROBLEM_LABELS|DISJOINT_PAIRS|RELATED_PAIRS|DEMO_REQUEST_LABEL|ProblemLabel/,
    );
  });

  it('keeps ground truth off the request fixtures', () => {
    for (const r of SEED_REQUESTS) {
      expect(Object.keys(r)).not.toContain('label');
      expect(Object.keys(r)).not.toContain('problem');
    }
  });
});

describe('strategy config', () => {
  it('states three to four goals for C5 to score strategic fit against', () => {
    const strategy = JSON.parse(readFileSync('./config/strategy.json', 'utf8'));
    expect(strategy.company).toBeTruthy();
    expect(strategy.goals.length).toBeGreaterThanOrEqual(3);
    expect(strategy.goals.length).toBeLessThanOrEqual(4);
    for (const g of strategy.goals) {
      expect(g.id).toBeTruthy();
      expect(g.statement.length).toBeGreaterThan(40);
      expect(g.signals.length).toBeGreaterThan(0);
    }
  });
});
