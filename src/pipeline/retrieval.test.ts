import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { describe, expect, it } from 'vitest';
import { ngramEmbed } from '../ai/ngram';
import { openSqlite } from '../db/index';
import { problems, schema } from '../db/schema';
import { retrieveCandidates } from './retrieval';
import { NGRAM_MODEL_ID, decodeVector, encodeVector } from './vectors';

const DIM = 16;

function freshDb() {
  const sqlite = openSqlite(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { sqlite, db };
}

function unit(values: number[]): Float32Array {
  const v = Float32Array.from(values.concat(Array(DIM - values.length).fill(0)));
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map((x) => x / n);
}

function addProblem(
  db: ReturnType<typeof freshDb>['db'],
  id: string,
  vector: Float32Array | null,
  embeddingModel: string | null,
  extra: { mergedIntoId?: string } = {},
) {
  db.insert(problems)
    .values({
      id,
      statement: `statement ${id}`,
      jobToBeDone: 'job',
      currentWorkaround: `workaround ${id}`,
      blockedOutcome: 'outcome',
      embedding: vector ? encodeVector(vector) : null,
      embeddingModel,
      ...extra,
    })
    .run();
}

describe('vector blob encoding', () => {
  it('round-trips without drift beyond float32 precision', () => {
    const original = Float32Array.from([0.1, -0.25, 1, 0, -1, 0.333333]);
    const back = decodeVector(encodeVector(original));
    expect(back).toHaveLength(original.length);
    for (let i = 0; i < original.length; i++) expect(back[i]).toBeCloseTo(original[i], 6);
  });

  it('rejects a blob that is not a whole number of floats', () => {
    expect(() => decodeVector(Buffer.alloc(7))).toThrow(/multiple of 4/);
  });
});

describe('retrieveCandidates', () => {
  it('ranks by similarity, descending', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-near', unit([1, 0.9]), 'test-embed');
    addProblem(db, 'p-far', unit([0, 1]), 'test-embed');
    addProblem(db, 'p-mid', unit([1, 0.3]), 'test-embed');

    const { candidates, comparable } = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(comparable).toBe(3);
    expect(candidates.map((c) => c.problemId)).toEqual(['p-mid', 'p-near', 'p-far']);
    expect(candidates[0].similarity).toBeGreaterThan(candidates[2].similarity);
    sqlite.close();
  });

  it('returns every problem by default, so retrieval imposes no recall ceiling', () => {
    const { sqlite, db } = freshDb();
    for (let i = 0; i < 12; i++) addProblem(db, `p${i}`, unit([1, i / 12]), 'test-embed');
    expect(retrieveCandidates(db, unit([1, 0]), 'gemini').candidates).toHaveLength(12);
    expect(retrieveCandidates(db, unit([1, 0]), 'gemini', { limit: 5 }).candidates).toHaveLength(5);
    sqlite.close();
  });

  it('NEVER compares across embedding spaces — the core safety property', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-gemini', unit([1, 0]), 'test-embed');
    addProblem(db, 'p-ngram', ngramEmbed('anything at all', DIM).vector, NGRAM_MODEL_ID);

    // An n-gram query must not see the Gemini problem…
    const asNgram = retrieveCandidates(db, ngramEmbed('a query', DIM).vector, 'ngram');
    expect(asNgram.candidates.map((c) => c.problemId)).toEqual(['p-ngram']);
    expect(asNgram.skippedForSpace).toBe(1);

    // …and a Gemini query must not see the n-gram problem.
    const asGemini = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(asGemini.candidates.map((c) => c.problemId)).toEqual(['p-gemini']);
    expect(asGemini.skippedForSpace).toBe(1);
    sqlite.close();
  });

  it('treats a dimension change as a space change rather than throwing', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-wrong-dim', Float32Array.from([1, 0, 0, 0]), 'test-embed');
    const result = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(result.candidates).toEqual([]);
    expect(result.skippedForSpace).toBe(1);
    sqlite.close();
  });

  it('counts unembedded problems separately from space mismatches', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-none', null, null);
    addProblem(db, 'p-ok', unit([1, 0]), 'test-embed');
    const result = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(result.skippedUnembedded).toBe(1);
    expect(result.skippedForSpace).toBe(0);
    expect(result.candidates).toHaveLength(1);
    sqlite.close();
  });

  it('excludes merged problems, whose evidence now lives on the survivor', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-survivor', unit([1, 0]), 'test-embed');
    addProblem(db, 'p-merged', unit([1, 0.99]), 'test-embed', { mergedIntoId: 'p-survivor' });
    const { candidates } = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(candidates.map((c) => c.problemId)).toEqual(['p-survivor']);
    sqlite.close();
  });

  it('returns nothing on an empty corpus, which is how the first request skips adjudication', () => {
    const { sqlite, db } = freshDb();
    const result = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(result.candidates).toEqual([]);
    expect(result.comparable).toBe(0);
    sqlite.close();
  });

  it('applies a similarity floor without disturbing the ranking', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-high', unit([1, 0.05]), 'test-embed');
    addProblem(db, 'p-low', unit([0.1, 1]), 'test-embed');
    const { candidates } = retrieveCandidates(db, unit([1, 0]), 'gemini', { minSimilarity: 0.5 });
    expect(candidates.map((c) => c.problemId)).toEqual(['p-high']);
    sqlite.close();
  });

  it('breaks similarity ties deterministically, so fixtures reproduce', () => {
    const { sqlite, db } = freshDb();
    addProblem(db, 'p-b', unit([1, 0]), 'test-embed');
    addProblem(db, 'p-a', unit([1, 0]), 'test-embed');
    const { candidates } = retrieveCandidates(db, unit([1, 0]), 'gemini');
    expect(candidates.map((c) => c.problemId)).toEqual(['p-a', 'p-b']);
    sqlite.close();
  });
});
