import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BEGIN, END, spliceGenerated } from './report';

const RESULTS_DOC = './docs/eval-results.md';

describe('the generated region of docs/eval-results.md', () => {
  const block = `${BEGIN}\nnumbers\n${END}`;

  it('replaces itself in place, so a re-run does not append a second copy', () => {
    const doc = `before\n\n${block}\n\nafter\n`;
    const next = spliceGenerated(doc, `${BEGIN}\nnew numbers\n${END}`);
    expect(next.match(new RegExp(BEGIN.replace(/[[\]()*+?.\\^$|]/g, '\\$&'), 'g'))).toHaveLength(1);
    expect(next).toContain('new numbers');
    expect(next).not.toContain('\nnumbers\n');
  });

  it('is idempotent — splicing the same block twice changes nothing', () => {
    const doc = `before\n\n${block}\n\nafter\n`;
    expect(spliceGenerated(spliceGenerated(doc, block), block)).toBe(spliceGenerated(doc, block));
  });

  it('leaves the hand-written analysis either side untouched', () => {
    const doc = `# Eval Results\n\nhand-written reasoning\n\n${block}\n\na known gap, written by a human\n`;
    const next = spliceGenerated(doc, `${BEGIN}\nfresh\n${END}`);
    expect(next).toContain('hand-written reasoning');
    expect(next).toContain('a known gap, written by a human');
  });

  it('appends with markers when the doc has none yet', () => {
    const next = spliceGenerated('# Eval Results\n\nprose\n', block);
    expect(next).toContain(BEGIN);
    expect(next.endsWith(`${END}\n`)).toBe(true);
  });

  it('is present in the real results doc, so `npm run eval` can find it', () => {
    const doc = readFileSync(RESULTS_DOC, 'utf8');
    expect(doc).toContain(BEGIN);
    expect(doc).toContain(END);
    expect(doc.indexOf(BEGIN)).toBeLessThan(doc.indexOf(END));
  });
});

describe('docs/eval-results.md keeps the v1 → v2 history', () => {
  const doc = readFileSync(RESULTS_DOC, 'utf8');

  it('still carries the v1 section and its diagnosis', () => {
    expect(doc).toContain('v1-b492db6f');
    expect(doc).toMatch(/when torn, answer/);
  });

  it('still carries the recall gap against its pre-registered target', () => {
    expect(doc).toContain('KNOWN GAP');
  });
});
