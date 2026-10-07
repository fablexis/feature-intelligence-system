import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { openSqlite } from '../db/index';
import { aiDecisions, schema } from '../db/schema';
import { canonicalText } from './canonical';
import { requireGeminiConfig } from './config';
import { withDecisionLog } from './decisions';
import { type FixtureEntry, loadFixtures } from './fixtures';
import { fixtureKey, stableStringify } from './hash';
import { cosine, ngramEmbed } from './ngram';
import { EMBED_PROMPT_VERSION, prompt } from './prompts';
import { createReplayProvider } from './replay';
import { ProblemDraftSchema, safeDistinct } from './schemas';
import type { ExtractInput } from './types';

beforeAll(() => {
  process.env.GEMINI_MODEL_FAST = 'test-fast';
  process.env.GEMINI_MODEL_STRONG = 'test-strong';
  process.env.GEMINI_MODEL_EMBED = 'test-embed';
  process.env.EMBED_DIM = '768';
});

const INPUT: ExtractInput = {
  title: 'CSV export of invoice lines',
  bodyRaw: 'She wants a CSV export button on the invoice list.',
  source: 'csm_note',
};

const DRAFT = {
  statement: 'Finance must re-enter figures into the system of record by hand',
  jobToBeDone: 'Move invoice figures into the general ledger',
  currentWorkaround: 'Copies the numbers into a spreadsheet manually',
  blockedOutcome: 'Month-end close takes days longer than it should',
  confidence: 0.86,
};

function fixtureFor(input: ExtractInput) {
  const key = fixtureKey({
    stage: 'extract',
    modelId: 'test-fast',
    promptVersion: prompt.extract().version,
    input,
  });
  return new Map<string, FixtureEntry>([[key, { key, stage: 'extract', output: DRAFT, tokens: 412 }]]);
}

describe('fixture keys', () => {
  it('ignore key order and incidental whitespace', () => {
    const base = { stage: 'extract' as const, modelId: 'm', promptVersion: 'p' };
    expect(fixtureKey({ ...base, input: { a: 1, b: 2 } })).toBe(
      fixtureKey({ ...base, input: { b: 2, a: 1 } }),
    );
    expect(fixtureKey({ ...base, input: 'a  b' })).toBe(fixtureKey({ ...base, input: ' A b ' }));
  });

  it('change when the model or the prompt changes, so stale fixtures miss loudly', () => {
    const base = { stage: 'extract' as const, promptVersion: 'p1', input: 'x' };
    expect(fixtureKey({ ...base, modelId: 'm1' })).not.toBe(fixtureKey({ ...base, modelId: 'm2' }));
    expect(fixtureKey({ ...base, modelId: 'm1', promptVersion: 'p2' })).not.toBe(
      fixtureKey({ ...base, modelId: 'm1' }),
    );
  });

  it('derives the prompt version from the prompt text itself', () => {
    const v = prompt.extract().version;
    expect(v).toMatch(/^v1-[0-9a-f]{8}$/);
    expect(prompt.adjudicate().version).not.toBe(v);
  });
});

describe('replay provider', () => {
  it('returns the identical recorded object twice in a row', async () => {
    const p = createReplayProvider(fixtureFor(INPUT));
    const a = await p.extractProblem(INPUT);
    const b = await p.extractProblem(INPUT);
    expect(a.value).toEqual(DRAFT);
    expect(a.value).toEqual(b.value);
    expect(a.meta.inputHash).toBe(b.meta.inputHash);
    expect(a.meta.degraded).toBe(false);
    expect(a.meta.provider).toBe('replay');
  });

  it('validates recorded output against the schema rather than trusting it', async () => {
    const key = fixtureKey({
      stage: 'extract',
      modelId: 'test-fast',
      promptVersion: prompt.extract().version,
      input: INPUT,
    });
    const corrupt = new Map<string, FixtureEntry>([
      [key, { key, stage: 'extract', output: { statement: 'too short' } }],
    ]);
    const result = await createReplayProvider(corrupt).extractProblem(INPUT);
    expect(result.meta.degraded).toBe(true);
    expect(result.value.confidence).toBe(0);
  });

  it('falls back to n-grams and flags degraded for unrecorded input', async () => {
    const p = createReplayProvider(new Map());
    const extract = await p.extractProblem(INPUT);
    expect(extract.meta.degraded).toBe(true);
    expect(extract.meta.provider).toBe('ngram');
    expect(extract.value.confidence).toBe(0);

    const embed = await p.embed({ text: 'something nobody recorded' });
    expect(embed.meta.degraded).toBe(true);
    expect(embed.value.space).toBe('ngram');
    expect(embed.value.vector).toHaveLength(768);
  });

  it('never proposes a merge when no model is available', async () => {
    const p = createReplayProvider(new Map());
    const { value, meta } = await p.adjudicate({
      draft: DRAFT,
      candidates: [
        { problemId: 'p1', statement: 's1', currentWorkaround: 'w1' },
        { problemId: 'p2', statement: 's2', currentWorkaround: 'w2' },
      ],
    });
    expect(meta.degraded).toBe(true);
    expect(value.map((v) => v.relation)).toEqual(['distinct', 'distinct']);
  });

  it('discards a verdict for a candidate that was never offered', async () => {
    const input = {
      draft: DRAFT,
      candidates: [{ problemId: 'p1', statement: 's1', currentWorkaround: 'w1' }],
    };
    const key = fixtureKey({
      stage: 'adjudicate',
      modelId: 'test-strong',
      promptVersion: prompt.adjudicate().version,
      input,
    });
    const injected = new Map<string, FixtureEntry>([
      [
        key,
        {
          key,
          stage: 'adjudicate',
          output: [
            { problemId: 'p1', relation: 'same', confidence: 0.9, rationale: 'ok' },
            { problemId: 'p-not-offered', relation: 'same', confidence: 1, rationale: 'injected' },
          ],
        },
      ],
    ]);
    const { value } = await createReplayProvider(injected).adjudicate(input);
    expect(value).toHaveLength(1);
    expect(value[0].problemId).toBe('p1');
  });
});

describe('embedding spaces', () => {
  it('keeps n-gram embeddings deterministic', () => {
    const a = ngramEmbed('month end close', 768);
    const b = ngramEmbed('month end close', 768);
    expect(cosine(a.vector, b.vector)).toBeCloseTo(1, 10);
  });

  it('matches near-identical wording but NOT a disjoint paraphrase', () => {
    const base = ngramEmbed('add a CSV export button to the invoice list', 768).vector;
    const nearly = ngramEmbed('add CSV export buttons to invoice lists', 768).vector;
    const paraphrase = ngramEmbed(
      'my controller transcribes each total into Sage by hand',
      768,
    ).vector;
    // This is the documented limit of the fallback, asserted so it cannot be
    // mistaken for the real capability (ADR 0004).
    expect(cosine(base, nearly)).toBeGreaterThan(0.5);
    expect(cosine(base, paraphrase)).toBeLessThan(0.2);
  });

  it('refuses to compare vectors of different dimension', () => {
    expect(() => cosine(new Float32Array(4), new Float32Array(8))).toThrow(/dimension mismatch/);
  });
});

describe('safe defaults', () => {
  it('resolves unknown candidates to distinct, never to a merge', () => {
    const verdicts = safeDistinct(['a', 'b'], 'because');
    expect(verdicts.every((v) => v.relation === 'distinct' && v.confidence === 0)).toBe(true);
  });

  it('rejects an out-of-range confidence', () => {
    expect(ProblemDraftSchema.safeParse({ ...DRAFT, confidence: 1.4 }).success).toBe(false);
  });
});

describe('ai_decisions logging', () => {
  it('writes exactly one row per call, with model, latency and prompt version', async () => {
    const sqlite = openSqlite(':memory:');
    const db = drizzle(sqlite, { schema });
    migrate(db, { migrationsFolder: './drizzle' });

    const logged = withDecisionLog(createReplayProvider(fixtureFor(INPUT)), db, () => ({}));
    await logged.extractProblem(INPUT);
    await logged.embed({ text: 'anything' });

    const rows = db.select().from(aiDecisions).all();
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.stage).sort()).toEqual(['embed', 'extract']);
    for (const row of rows) {
      expect(row.modelId).toBeTruthy();
      expect(row.promptVersion).toBeTruthy();
      expect(row.inputHash).toMatch(/^[0-9a-f]{64}$/);
      expect(row.latencyMs).toBeGreaterThanOrEqual(0);
    }
    // The vector itself is not logged — only its shape.
    const embedRow = rows.find((r) => r.stage === 'embed');
    expect(embedRow?.outputJson).toEqual({ dim: 768, space: 'ngram' });
    sqlite.close();
  });
});

describe('secrets and model ids', () => {
  it('keeps model ids out of source', () => {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = `${dir}/${e.name}`;
        if (e.isDirectory()) walk(p);
        // Test files are exempt: asserting on a real error message requires
        // the literal model id that produced it.
        else if (/\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk('./src');
    walk('./scripts');
    const offenders = files.filter((f) => /gemini-\d/.test(readFileSync(f, 'utf8')));
    expect(offenders).toEqual([]);
  });

  it('never writes a credential into a fixture', () => {
    if (!existsSync('./fixtures')) return;
    for (const name of readdirSync('./fixtures')) {
      const raw = readFileSync(`./fixtures/${name}`, 'utf8');
      expect(raw).not.toMatch(/AIza[0-9A-Za-z_-]{10,}/); // Google API key shape
      expect(raw.toLowerCase()).not.toMatch(/"(authorization|api[_-]?key|x-goog-api-key)"/);
    }
  });

  it('keeps fixture entries to model output only', () => {
    const fixtures = loadFixtures();
    for (const entry of fixtures.values()) {
      expect(Object.keys(entry).sort()).toEqual(
        expect.arrayContaining(['key', 'output', 'stage']),
      );
      for (const k of Object.keys(entry)) {
        expect(['key', 'stage', 'output', 'tokens']).toContain(k);
      }
    }
  });

  it('reports missing env by name and never by value', () => {
    const saved = process.env.GEMINI_MODEL_FAST;
    delete process.env.GEMINI_MODEL_FAST;
    process.env.GOOGLE_GENERATIVE_AI_API_KEY = 'AIzaFAKEVALUEFORTEST';
    try {
      expect(() => requireGeminiConfig()).toThrow(/GEMINI_MODEL_FAST/);
      let message = '';
      try {
        requireGeminiConfig();
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).not.toContain('AIzaFAKEVALUEFORTEST');
    } finally {
      process.env.GEMINI_MODEL_FAST = saved;
      delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    }
  });
});

describe('canonical text', () => {
  it('is shared with the record script so embeddings cannot drift apart', () => {
    expect(canonicalText(DRAFT)).toBe(
      [DRAFT.statement, DRAFT.jobToBeDone, DRAFT.currentWorkaround, DRAFT.blockedOutcome].join(' | '),
    );
    const script = readFileSync('./scripts/record.ts', 'utf8');
    expect(script).toMatch(/from '\.\.\/src\/ai\/canonical'/);
  });

  it('keys embeddings on the canonical text', () => {
    const key = fixtureKey({
      stage: 'embed',
      modelId: 'test-embed',
      promptVersion: EMBED_PROMPT_VERSION,
      input: canonicalText(DRAFT),
    });
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(stableStringify({ a: 1 })).toBe('{"a":1}');
  });
});
