import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import { beforeAll, describe, expect, it } from 'vitest';
import { ngramEmbed } from '../ai/ngram';
import type { AiProvider, AiResult } from '../ai/types';
import { openSqlite } from '../db/index';
import { dedupeSuggestions, evidenceLinks, problems, requests, schema } from '../db/schema';
import { ingestRequest, problemIdFor } from './ingest';
import { encodeVector, modelIdFor } from './vectors';

beforeAll(() => {
  process.env.GEMINI_MODEL_FAST = 'test-fast';
  process.env.GEMINI_MODEL_STRONG = 'test-strong';
  process.env.GEMINI_MODEL_EMBED = 'test-embed';
  process.env.EMBED_DIM = '16';
});

const DIM = 16;
const OPTS = { tAuto: 0.8, candidateLimit: 'all' as const, minSimilarity: 0 };

const DRAFT = {
  statement: 'Finance must re-enter figures into the ledger by hand every period',
  jobToBeDone: 'Move invoice figures into the system of record',
  currentWorkaround: 'Types the numbers in again downstream',
  blockedOutcome: 'Month-end close runs days long',
  confidence: 0.9,
};

const meta = (degraded: boolean) => ({
  provider: degraded ? ('ngram' as const) : ('replay' as const),
  modelId: 'test',
  promptVersion: 'v1',
  inputHash: 'h',
  latencyMs: 1,
  degraded,
});

/** A provider whose stages can each be made to fail or degrade on demand. */
function provider(opts: {
  extractDegraded?: boolean;
  embedDegraded?: boolean;
  adjudicateDegraded?: boolean;
  verdictRelation?: 'same' | 'related' | 'distinct';
  verdictConfidence?: number;
}): AiProvider {
  return {
    name: 'replay',
    async extractProblem() {
      return {
        value: opts.extractDegraded ? { ...DRAFT, confidence: 0 } : DRAFT,
        meta: meta(!!opts.extractDegraded),
      } as AiResult<typeof DRAFT>;
    },
    async embed({ text }) {
      return {
        value: {
          vector: ngramEmbed(text, DIM).vector,
          space: opts.embedDegraded ? ('ngram' as const) : ('gemini' as const),
        },
        meta: meta(!!opts.embedDegraded),
      };
    },
    async adjudicate({ candidates }) {
      return {
        value: candidates.map((c) => ({
          problemId: c.problemId,
          relation: opts.adjudicateDegraded
            ? ('distinct' as const)
            : (opts.verdictRelation ?? ('distinct' as const)),
          confidence: opts.adjudicateDegraded ? 0 : (opts.verdictConfidence ?? 0.9),
          rationale: 'test',
        })),
        meta: meta(!!opts.adjudicateDegraded),
      };
    },
    async estimateFactors() {
      throw new Error('not used');
    },
  };
}

function freshDb() {
  const sqlite = openSqlite(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return { sqlite, db };
}

function seedExisting(db: ReturnType<typeof freshDb>['db'], space: 'gemini' | 'ngram' = 'gemini') {
  db.insert(problems)
    .values({
      id: 'p-existing',
      statement: DRAFT.statement,
      jobToBeDone: DRAFT.jobToBeDone,
      currentWorkaround: DRAFT.currentWorkaround,
      blockedOutcome: DRAFT.blockedOutcome,
      embedding: encodeVector(
        ngramEmbed(
          [DRAFT.statement, DRAFT.jobToBeDone, DRAFT.currentWorkaround, DRAFT.blockedOutcome].join(' | '),
          DIM,
        ).vector,
      ),
      embeddingModel: modelIdFor(space, 'test-embed'),
    })
    .run();
}

function addRequest(db: ReturnType<typeof freshDb>['db'], id: string) {
  db.insert(requests)
    .values({
      id,
      title: 'Closing the books means a week of retyping',
      bodyRaw: 'My controller transcribes each total into Sage by hand.',
      submitterKind: 'customer',
      source: 'customer_direct',
    })
    .run();
  return { id, title: 'Closing the books means a week of retyping', bodyRaw: 'My controller transcribes each total into Sage by hand.', source: 'customer_direct' as const };
}

describe('stage fallbacks never produce a merge', () => {
  it('does not merge when adjudication is unavailable, even on a near-identical problem', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db);
    const req = addRequest(db, 'r-1');

    const result = await ingestRequest(db, provider({ adjudicateDegraded: true }), req, OPTS);

    // The candidate was retrieved and is near-identical, but with no working
    // adjudicator the only safe answer is a new problem.
    expect(result.candidates.length).toBe(1);
    expect(result.resolution.kind).toBe('create');
    expect(result.degraded).toBe(true);
    expect(db.select().from(problems).all()).toHaveLength(2);
    sqlite.close();
  });

  it('does not merge when extraction degrades', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db);
    const req = addRequest(db, 'r-2');
    const result = await ingestRequest(
      db,
      provider({ extractDegraded: true, adjudicateDegraded: true }),
      req,
      OPTS,
    );
    expect(result.resolution.kind).toBe('create');
    expect(result.degraded).toBe(true);
    sqlite.close();
  });

  it('marks the request degraded rather than dropping it', async () => {
    const { sqlite, db } = freshDb();
    const req = addRequest(db, 'r-3');
    await ingestRequest(db, provider({ embedDegraded: true }), req, OPTS);
    const row = db.select().from(requests).all()[0];
    expect(row.degraded).toBe(true);
    expect(row.resolution).toBe('created');
    expect(row.triagedAt).toBeTruthy();
    // Verbatim text is untouched by any of this.
    expect(row.bodyRaw).toContain('transcribes each total into Sage');
    sqlite.close();
  });

  it('cannot see a problem in another embedding space, so it creates instead of merging', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db, 'ngram'); // existing problem embedded by the fallback
    const req = addRequest(db, 'r-4');
    // …and a healthy gemini-space query arrives
    const result = await ingestRequest(db, provider({ verdictRelation: 'same' }), req, OPTS);
    expect(result.candidates).toHaveLength(0);
    expect(result.resolution.kind).toBe('create');
    expect(result.degraded).toBe(true); // space mismatch is reported, not hidden
    sqlite.close();
  });
});

describe('successful resolution paths', () => {
  it('auto-attaches a high-confidence same verdict and records the suggestion', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db);
    const req = addRequest(db, 'r-5');
    const result = await ingestRequest(
      db,
      provider({ verdictRelation: 'same', verdictConfidence: 0.95 }),
      req,
      OPTS,
    );
    expect(result.resolution.kind).toBe('attach');
    const links = db.select().from(evidenceLinks).all();
    expect(links).toHaveLength(1);
    expect(links[0].problemId).toBe('p-existing');
    expect(links[0].needsReview).toBe(false);
    const sug = db.select().from(dedupeSuggestions).all();
    expect(sug).toHaveLength(1);
    expect(sug[0].humanAction).toBe('auto');
    expect(db.select().from(problems).all()).toHaveLength(1); // no new problem
    sqlite.close();
  });

  it('attaches but flags for review when confidence is below T_auto', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db);
    const req = addRequest(db, 'r-6');
    const result = await ingestRequest(
      db,
      provider({ verdictRelation: 'same', verdictConfidence: 0.55 }),
      req,
      OPTS,
    );
    expect(result.resolution.kind === 'attach' && result.resolution.auto).toBe(false);
    expect(db.select().from(evidenceLinks).all()[0].needsReview).toBe(true);
    expect(db.select().from(dedupeSuggestions).all()[0].humanAction).toBe('unsure');
    sqlite.close();
  });

  it('records a rejected suggestion, so M1 can see what was declined', async () => {
    const { sqlite, db } = freshDb();
    seedExisting(db);
    const req = addRequest(db, 'r-7');
    await ingestRequest(db, provider({ verdictRelation: 'distinct' }), req, OPTS);
    const sug = db.select().from(dedupeSuggestions).all();
    expect(sug).toHaveLength(1);
    expect(sug[0].verdict).toBe('distinct');
    expect(sug[0].humanAction).toBeNull();
    expect(db.select().from(problems).all()).toHaveLength(2);
    sqlite.close();
  });

  it('forms problem ids from the forming request, so fixture keys reproduce', async () => {
    const { sqlite, db } = freshDb();
    const req = addRequest(db, 'r-8');
    await ingestRequest(db, provider({}), req, OPTS);
    expect(db.select().from(problems).all()[0].id).toBe(problemIdFor('r-8'));
    sqlite.close();
  });
});
