/**
 * Evidence strength, defined once.
 *
 * [ARCHITECTURE](../../docs/ARCHITECTURE.md#data-model) resolves PRODUCT open
 * question 2: evidence strength is a **raw count of distinct accounts**, never
 * ARR-weighted — ARR reaches the score through `customer_value` alone, because
 * weighting it twice would double-count the same signal and make the score's
 * most gameable input also its least visible.
 *
 * "Distinct accounts" is the **union** of two ways an account can be affected:
 * it wrote in (an active evidence link), or it clicked "this affects us too" (a
 * `supports` row). Either is a real account reporting a real problem, and an
 * account that did both must count once, not twice — which is why this lives in
 * one function that the list, the detail page and C5's scoring all read.
 *
 * The breakdown is kept alongside the total on purpose. The seeded corpus has
 * no `supports` rows, so the demo can say "nine accounts wrote in, none of them
 * clicked a button" and be checked on it ([DEMO](../../docs/DEMO.md)).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Db } from '../db/index';
import { accounts, evidenceLinks, problems, requests, supports } from '../db/schema';

export type ProblemStats = {
  problemId: string;
  /** Active evidence links — requests whose text is attached right now. */
  requestCount: number;
  /** Distinct accounts that wrote in. Internal notes carry no account. */
  writeInAccounts: number;
  /** Distinct accounts that clicked, excluding any that also wrote in. */
  supportOnlyAccounts: number;
  /** **Evidence strength**: distinct accounts affected, counted once each. */
  strength: number;
  /** Attached below `T_auto`, so a PM still owes it a look. */
  needsReview: number;
  /** Evidence links turned off by an un-merge. Nothing is ever deleted. */
  detached: number;
};

const empty = (problemId: string): ProblemStats => ({
  problemId,
  requestCount: 0,
  writeInAccounts: 0,
  supportOnlyAccounts: 0,
  strength: 0,
  needsReview: 0,
  detached: 0,
});

/**
 * Stats for many problems in four queries rather than four per problem.
 *
 * Grouped in JS rather than SQL: at a few hundred problems the difference is
 * unmeasurable, and one readable definition that the list and the detail page
 * demonstrably share is worth more than the query count.
 */
export function problemStats(db: Db, problemIds?: string[]): Map<string, ProblemStats> {
  const ids =
    problemIds ??
    db
      .select({ id: problems.id })
      .from(problems)
      .all()
      .map((p) => p.id);
  const out = new Map(ids.map((id) => [id, empty(id)]));
  if (ids.length === 0) return out;

  const links = db
    .select({
      problemId: evidenceLinks.problemId,
      accountId: requests.accountId,
      active: evidenceLinks.active,
      needsReview: evidenceLinks.needsReview,
    })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .where(inArray(evidenceLinks.problemId, ids))
    .all();

  const writeIn = new Map<string, Set<string>>();
  for (const link of links) {
    const stats = out.get(link.problemId);
    if (!stats) continue;
    if (!link.active) {
      stats.detached++;
      continue;
    }
    stats.requestCount++;
    if (link.needsReview) stats.needsReview++;
    if (link.accountId) {
      const set = writeIn.get(link.problemId) ?? new Set<string>();
      set.add(link.accountId);
      writeIn.set(link.problemId, set);
    }
  }

  const clicked = db
    .select({ problemId: supports.problemId, accountId: supports.accountId })
    .from(supports)
    .where(inArray(supports.problemId, ids))
    .all();

  const supportOnly = new Map<string, Set<string>>();
  for (const row of clicked) {
    if (!out.has(row.problemId)) continue;
    if (writeIn.get(row.problemId)?.has(row.accountId)) continue;
    const set = supportOnly.get(row.problemId) ?? new Set<string>();
    set.add(row.accountId);
    supportOnly.set(row.problemId, set);
  }

  for (const stats of out.values()) {
    stats.writeInAccounts = writeIn.get(stats.problemId)?.size ?? 0;
    stats.supportOnlyAccounts = supportOnly.get(stats.problemId)?.size ?? 0;
    stats.strength = stats.writeInAccounts + stats.supportOnlyAccounts;
  }
  return out;
}

export function statsFor(db: Db, problemId: string): ProblemStats {
  return problemStats(db, [problemId]).get(problemId) ?? empty(problemId);
}

export type EvidenceItem = {
  linkId: string;
  requestId: string;
  title: string;
  /** Verbatim and immutable. The abstraction indexes it, never replaces it. */
  bodyRaw: string;
  source: string;
  accountName: string | null;
  segment: string | null;
  needsReview: boolean;
  confidence: number | null;
  createdBy: string;
  active: boolean;
};

/**
 * Every evidence link on a problem, detached ones included.
 *
 * Detached links are returned rather than filtered out because un-merging
 * flips a flag instead of deleting a row, and a reversal nobody can see is
 * indistinguishable from a deletion.
 */
export function evidenceFor(db: Db, problemId: string): EvidenceItem[] {
  return db
    .select({
      linkId: evidenceLinks.id,
      requestId: requests.id,
      title: requests.title,
      bodyRaw: requests.bodyRaw,
      source: requests.source,
      accountName: accounts.name,
      segment: accounts.segment,
      needsReview: evidenceLinks.needsReview,
      confidence: evidenceLinks.confidence,
      createdBy: evidenceLinks.createdBy,
      active: evidenceLinks.active,
    })
    .from(evidenceLinks)
    .innerJoin(requests, eq(evidenceLinks.requestId, requests.id))
    .leftJoin(accounts, eq(requests.accountId, accounts.id))
    .where(eq(evidenceLinks.problemId, problemId))
    .orderBy(requests.createdAt)
    .all();
}

/**
 * Every problem that is still its own problem.
 *
 * Merged problems are excluded here rather than by the caller, mirroring
 * `retrieveCandidates`: a merged problem is not a destination, because its
 * evidence now lives on the survivor. Doing it in one place means the list and
 * retrieval cannot disagree about what exists.
 */
export function listProblems(db: Db) {
  return db
    .select({
      id: problems.id,
      statement: problems.statement,
      jobToBeDone: problems.jobToBeDone,
      currentWorkaround: problems.currentWorkaround,
    })
    .from(problems)
    .where(isNull(problems.mergedIntoId))
    .all();
}

/** Accounts, for the "this affects us too" picker. */
export function allAccounts(db: Db) {
  return db
    .select({ id: accounts.id, name: accounts.name, segment: accounts.segment })
    .from(accounts)
    .orderBy(accounts.name)
    .all();
}

/** Has this account already said it is affected? Used to keep the click idempotent. */
export function supportExists(db: Db, problemId: string, accountId: string): boolean {
  return (
    db
      .select({ id: supports.id })
      .from(supports)
      .where(and(eq(supports.problemId, problemId), eq(supports.accountId, accountId)))
      .get() !== undefined
  );
}
