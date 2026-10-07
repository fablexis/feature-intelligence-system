/**
 * The data around scoring: what the model is shown, what gets stored, and how
 * a citation turns back into a request a PM can read.
 *
 * `score_runs` is append-only (ARCHITECTURE data model). A re-score adds a row
 * and never overwrites one, so a band that changed can always be traced to the
 * factors and the weights version that produced it.
 */
import { and, asc, eq, sql } from 'drizzle-orm';
import { readFileSync } from 'node:fs';
import type { FactorsInput } from '../ai/types';
import type { Factors } from '../ai/schemas';
import { FactorsSchema } from '../ai/schemas';
import type { Db } from '../db/index';
import { accounts, evidenceLinks, humanOverrides, problems, requests, scoreRuns } from '../db/schema';
import type { Scored } from './score';

export const STRATEGY_PATH = './config/strategy.json';

export const loadStrategy = (path = STRATEGY_PATH): unknown =>
  JSON.parse(readFileSync(path, 'utf8'));

/**
 * What the model sees for one problem.
 *
 * **Deterministic by construction**, because the fixture key is a hash of this
 * object: evidence is ordered by link id, and only *active* evidence is
 * included. Two consequences worth stating:
 *
 *  - `supports` rows are deliberately absent. A "this affects us too" click
 *    would change this input and so miss every recorded fixture, and the model
 *    does not need it: the written evidence is what it is reading. The raw
 *    distinct-account count shown next to the band *does* include clicks —
 *    that number is arithmetic, not judgement.
 *  - Un-merging evidence changes this input, which misses the fixture and shows
 *    as degraded. That is correct: the evidence changed, so the estimate is
 *    stale and should say so rather than silently standing.
 */
export function factorsInputFor(db: Db, problemId: string, strategy: unknown): FactorsInput {
  const problem = db.select().from(problems).where(eq(problems.id, problemId)).get();
  if (!problem) throw new Error(`unknown problem: ${problemId}`);

  const evidence = db
    .select({
      id: evidenceLinks.id,
      title: requests.title,
      bodyRaw: requests.bodyRaw,
      accountName: accounts.name,
      segment: accounts.segment,
      arrCents: accounts.arrCents,
    })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .where(and(eq(evidenceLinks.problemId, problemId), eq(evidenceLinks.active, true)))
    .orderBy(asc(evidenceLinks.id))
    .all();

  return {
    statement: problem.statement,
    evidence: evidence.map((e) => ({
      id: e.id,
      text: `${e.title} — ${e.bodyRaw}`,
      accountName: e.accountName ?? undefined,
      segment: e.segment ?? undefined,
      arrUsd: e.arrCents === null ? undefined : Math.round(e.arrCents / 100),
    })),
    strategy,
  };
}

/**
 * Append a score run. Never an update — the whole value of the table is that
 * yesterday's band and the factors behind it are still there tomorrow.
 */
export function recordRun(
  db: Db,
  args: { problemId: string; factors: Factors; scored: Scored; modelId: string },
) {
  db.insert(scoreRuns)
    .values({
      problemId: args.problemId,
      weightsVersion: args.scored.weightsVersion,
      factorsJson: args.factors,
      rawScore: args.scored.raw,
      band: args.scored.band,
      confidence: args.factors.confidence,
      modelId: args.modelId,
    })
    .run();
}

export type StoredRun = {
  id: string;
  problemId: string;
  factors: Factors;
  /** The weights version in force when the row was written. */
  weightsVersion: string;
  /** The band as recorded. The board re-derives it from the current weights. */
  recordedBand: string;
  recordedRaw: number;
  modelId: string;
  createdAt: Date;
};

/**
 * The newest run per problem, with `factors_json` validated on the way out.
 *
 * Validated rather than trusted because the column is JSON: a row written by
 * an older schema would otherwise crash the board at render time, which is the
 * worst place to discover it. A row that fails the schema is skipped, so the
 * problem simply shows as unscored.
 */
export function latestRuns(db: Db): Map<string, StoredRun> {
  // Ordered by rowid, not by `created_at`: two runs in the same second would
  // tie on the timestamp, and the id is a random uuid, so a tie-break on it
  // would pick an arbitrary row rather than the latest one. SQLite's rowid is
  // insertion order, which is exactly the question being asked.
  const rows = db
    .select()
    .from(scoreRuns)
    .orderBy(sql`rowid desc`)
    .all();

  const out = new Map<string, StoredRun>();
  for (const row of rows) {
    if (out.has(row.problemId)) continue; // newest wins; the rest are history
    const parsed = FactorsSchema.safeParse(row.factorsJson);
    if (!parsed.success) continue;
    out.set(row.problemId, {
      id: row.id,
      problemId: row.problemId,
      factors: parsed.data,
      weightsVersion: row.weightsVersion,
      recordedBand: row.band,
      recordedRaw: row.rawScore,
      modelId: row.modelId,
      createdAt: row.createdAt,
    });
  }
  return out;
}

/** How many runs exist per problem, to show that re-scoring appended. */
export function runCounts(db: Db): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of db.select({ problemId: scoreRuns.problemId }).from(scoreRuns).all()) {
    counts.set(row.problemId, (counts.get(row.problemId) ?? 0) + 1);
  }
  return counts;
}

/**
 * Evidence id → the request behind it, so a citation renders as something a PM
 * can read instead of an opaque key. A cited id that no longer exists is
 * reported rather than hidden: it means the evidence set moved under the score.
 */
export function citationIndex(db: Db, problemId: string): Map<string, { title: string; accountName: string | null }> {
  const rows = db
    .select({ id: evidenceLinks.id, title: requests.title, accountName: accounts.name })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .where(eq(evidenceLinks.problemId, problemId))
    .all();
  return new Map(rows.map((r) => [r.id, { title: r.title, accountName: r.accountName }]));
}

export type BandOverride = {
  suggested: string | null;
  final: string | null;
  reason: string | null;
  actor: string;
  createdAt: Date;
};

/**
 * The newest band override per problem.
 *
 * `human_overrides` is append-only, so an override is never edited — a PM
 * changing their mind appends another row and the earlier judgement is still
 * on record. Only the newest one is in force.
 */
export function latestBandOverrides(db: Db): Map<string, BandOverride> {
  const rows = db
    .select()
    .from(humanOverrides)
    .where(and(eq(humanOverrides.targetType, 'problem_band'), eq(humanOverrides.field, 'band')))
    // Insertion order, for the same reason as `latestRuns`.
    .orderBy(sql`rowid desc`)
    .all();

  const out = new Map<string, BandOverride>();
  for (const row of rows) {
    if (out.has(row.targetId)) continue;
    out.set(row.targetId, {
      suggested: row.suggestedValue,
      final: row.finalValue,
      reason: row.reason,
      actor: row.actor,
      createdAt: row.createdAt,
    });
  }
  return out;
}

/** Total ARR behind a problem's active evidence — display context only. */
export function arrFor(db: Db, problemId: string): number {
  const rows = db
    .select({ accountId: requests.accountId, arrCents: accounts.arrCents })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .where(and(eq(evidenceLinks.problemId, problemId), eq(evidenceLinks.active, true)))
    .all();
  const seen = new Set<string>();
  let cents = 0;
  for (const row of rows) {
    if (!row.accountId || seen.has(row.accountId)) continue;
    seen.add(row.accountId);
    cents += row.arrCents ?? 0;
  }
  return Math.round(cents / 100);
}
